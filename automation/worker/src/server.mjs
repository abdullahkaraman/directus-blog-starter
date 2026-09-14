import { timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import http from 'node:http';

import { runCodexJob, runCodexLearning, runCodexReview } from './codex-runner.mjs';
import { runArticleQualityGate } from './article-pipeline.mjs';
import { CallbackOutbox, createPendingNotification } from './callback-outbox.mjs';
import { loadConfig } from './config.mjs';
import {
	createDirectusDraft,
	getDirectusDraftForEdit,
	getDirectusPostForLearning,
	getEditorialContext,
	publishDirectusPost,
	updateDirectusDraft,
} from './directus.mjs';
import { EditorialMemoryStore } from './editorial-memory.mjs';
import { upsertExecution } from './execution-metrics.mjs';
import { resolveTelegramJobCommand } from './job-commands.mjs';
import { JobStore } from './job-store.mjs';
import { buildPublicationLearningContext } from './learning.mjs';
import {
	ensurePublicationLearningJob,
	publicationLearningState,
	reconcilePublicationLearningJobs,
	setPublicationLearningState,
} from './learning-jobs.mjs';
import { OperationsMonitor } from './operations-monitor.mjs';
import { recordSourcePublication } from './publication-jobs.mjs';
import { cleanupRetention } from './retention.mjs';
import { parseJobRequest } from './submission.mjs';
import { formatTelegramCommandError, TelegramCommandError } from './telegram-commands.mjs';

function dropRuntimePrivileges(uid = 1000, gid = 1000) {
	if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;

	try {
		process.setgroups([]);
		process.setgid(gid);
		process.setuid(uid);
	} catch (error) {
		throw new Error(
			`Worker could not drop root privileges to ${uid}:${gid}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}

	if (process.getuid() !== uid || process.getgid() !== gid) {
		throw new Error(`Worker privilege drop verification failed; expected ${uid}:${gid}.`);
	}
}

const config = loadConfig();
dropRuntimePrivileges();
const store = new JobStore(config.jobsDir);
const memoryStore = new EditorialMemoryStore({ stateFile: config.editorialStateFile });
const operationsMonitor = new OperationsMonitor({
	stateFile: config.operationsStateFile,
	dataDir: config.dataDir,
	backupStatusFile: config.backupStatusFile,
	backupMaxAgeHours: config.backupMaxAgeHours,
	failureAlertThreshold: config.failureAlertThreshold,
	learningFailureAlertThreshold: config.learningFailureAlertThreshold,
	alertDedupeHours: config.alertDedupeHours,
});
const callbackOutbox = new CallbackOutbox({
	store,
	callbackUrl: config.n8nCallbackUrl,
	callbackToken: config.n8nCallbackToken,
	serializeJob: publicJob,
});
let stopping = false;
let activeJobId = null;
let activeJobController = null;

function secureEqual(left, right) {
	const leftBuffer = Buffer.from(left || '');
	const rightBuffer = Buffer.from(right || '');
	if (leftBuffer.length !== rightBuffer.length) return false;

	return timingSafeEqual(leftBuffer, rightBuffer);
}

function sendJson(response, status, body) {
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	response.end(`${JSON.stringify(body)}\n`);
}

function cancelledError() {
	const error = new Error('Job was cancelled before an external write began.');
	error.name = 'AbortError';
	error.code = 'ABORT_ERR';

	return error;
}

async function readJson(request, maxBytes = 64 * 1024) {
	let body = '';
	for await (const chunk of request) {
		body += chunk.toString();
		if (Buffer.byteLength(body) > maxBytes) throw new Error('Request body is too large.');
	}

	return JSON.parse(body || '{}');
}

function publicJob(job) {
	if (!job) return null;

	return {
		id: job.id,
		type: job.type,
		status: job.status,
		attempts: job.attempts,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		startedAt: job.startedAt,
		completedAt: job.completedAt,
		telegramChatId: job.telegramChatId,
		threadId: job.threadId,
		result: job.result,
		error: job.error,
		progress: job.progress,
		failureStage: job.failureStage,
		cancelRequestedAt: job.cancelRequestedAt,
		cancelledAt: job.cancelledAt,
		retriedFromJobId: job.retriedFromJobId,
		selectedFromIdeaJobId: job.selectedFromIdeaJobId,
		selectedIdeaNumber: job.selectedIdeaNumber,
		metrics: job.metrics,
	};
}

function authorized(request) {
	const header = request.headers.authorization || '';
	const expected = `Bearer ${config.workerApiToken}`;

	return secureEqual(header, expected);
}

function validateSubmission(body) {
	const rawPrompt = String(body.prompt || '').trim();
	const telegramChatId = String(body.telegramChatId || '').trim();
	const telegramUserId = String(body.telegramUserId || '').trim();
	const idempotencyKey = String(body.idempotencyKey || '').trim();
	if (telegramUserId !== config.telegramAllowedUserId) throw new Error('Telegram user is not authorized.');
	if (telegramChatId !== config.telegramAllowedChatId) throw new Error('Telegram chat is not authorized.');
	if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new Error('idempotencyKey is invalid.');
	const parsedRequest = parseJobRequest(rawPrompt, config.contentProfile);

	return {
		...parsedRequest,
		prompt: parsedRequest.prompt || rawPrompt,
		telegramChatId,
		telegramUserId,
		idempotencyKey,
	};
}

async function deliverJobNotification(jobId) {
	try {
		await callbackOutbox.deliver(jobId);
	} catch (error) {
		console.error('Callback outbox error:', error instanceof Error ? error.message : String(error));
	}
}

async function flushCallbackOutbox() {
	try {
		await callbackOutbox.flush();
	} catch (error) {
		console.error('Callback outbox flush failed:', error instanceof Error ? error.message : String(error));
	}
}

async function processJob(job) {
	activeJobId = job.id;
	activeJobController = new AbortController();
	const { signal } = activeJobController;
	const startedAt = new Date().toISOString();
	const started = await store.mutate(job.id, (current) => {
		if (current.status !== 'queued') return null;

		return {
			status: 'running',
			startedAt,
			completedAt: null,
			attempts: current.attempts + 1,
			error: null,
			failureStage: null,
			progress: {
				stage: 'starting',
				message: 'İş hazırlanıyor.',
				updatedAt: startedAt,
			},
		};
	});
	if (started?.status !== 'running') {
		activeJobId = null;
		activeJobController = null;
		return;
	}
	const recordExecution = (execution) =>
		store.mutate(job.id, (current) => ({ metrics: upsertExecution(current.metrics, execution) }));

	try {
		const dynamicEditorialMemory = await memoryStore.getSnapshot();
		if (job.type === 'publish') {
			signal.throwIfAborted();
			await store.update(job.id, {
				progress: {
					stage: 'validating-source',
					message: 'Yayınlanacak taslak doğrulanıyor.',
					updatedAt: new Date().toISOString(),
				},
			});
			const sourceJob = await store.get(job.targetJobId);
			if (!sourceJob || sourceJob.status !== 'completed' || !sourceJob.result?.postId || !sourceJob.result?.slug) {
				throw new Error('Yayınlanabilir tamamlanmış bir yazı işi bulunamadı.');
			}
			if (sourceJob.telegramChatId !== job.telegramChatId || sourceJob.telegramUserId !== job.telegramUserId) {
				throw new Error('Bu yazı işi mevcut Telegram kullanıcısına ait değil.');
			}
			const publishing = await store.mutate(job.id, (current) => {
				if (current.status !== 'running' || signal.aborted) return null;
				return {
					progress: {
						stage: 'publishing',
						message: 'Taslak Directus üzerinde yayınlanıyor.',
						updatedAt: new Date().toISOString(),
					},
				};
			});
			if (publishing.status !== 'running' || publishing.progress?.stage !== 'publishing') throw cancelledError();
			signal.throwIfAborted();
			const published = await publishDirectusPost(config, sourceJob.result.postId);
			const publishedUrl = `${config.siteUrl}${config.contentProfile.routes.publicPost}/${encodeURIComponent(published.slug || sourceJob.result.slug)}`;
			const completedAt = new Date().toISOString();
			let completed = await store.update(job.id, {
				status: 'completed',
				completedAt,
				result: {
					kind: 'publish',
					targetJobId: sourceJob.id,
					postId: sourceJob.result.postId,
					title: published.title || sourceJob.result.title,
					url: publishedUrl,
					publishedAt: published.publishedAt,
					learning: { status: 'queued', jobId: null },
				},
				error: null,
				notification: createPendingNotification(completedAt),
				progress: {
					stage: 'completed',
					message: 'Yazı yayınlandı.',
					updatedAt: completedAt,
				},
			});
			await recordSourcePublication(store, sourceJob, { publishedAt: published.publishedAt, publishedUrl });
			try {
				await ensurePublicationLearningJob(store, completed);
			} catch (learningQueueError) {
				const learningQueueMessage = String(
					learningQueueError instanceof Error ? learningQueueError.message : learningQueueError,
				).slice(0, 1_000);
				try {
					completed = await setPublicationLearningState(store, completed.id, {
						status: 'failed',
						jobId: null,
						error: learningQueueMessage,
					});
				} catch (learningStateError) {
					console.error(
						'Could not persist publication learning queue failure:',
						learningStateError instanceof Error ? learningStateError.message : String(learningStateError),
					);
				}
			}
			await deliverJobNotification(completed.id);

			return;
		}
		if (job.type === 'learning') {
			await setPublicationLearningState(store, job.targetJobId, { status: 'running', jobId: job.id });
			const [publicationJob, sourceJob, finalArticle, jobs] = await Promise.all([
				store.get(job.targetJobId),
				store.get(job.sourceJobId),
				getDirectusPostForLearning(config, job.postId),
				store.list(),
			]);
			if (!publicationJob || publicationJob.type !== 'publish' || publicationJob.status !== 'completed') {
				throw new Error('Öğrenme için tamamlanmış yayın işi bulunamadı.');
			}
			if (!sourceJob || sourceJob.result?.postId !== job.postId) {
				throw new Error('Öğrenme için yayın kaynak zinciri bulunamadı.');
			}
			if (
				publicationJob.telegramChatId !== job.telegramChatId ||
				publicationJob.telegramUserId !== job.telegramUserId ||
				sourceJob.telegramChatId !== job.telegramChatId ||
				sourceJob.telegramUserId !== job.telegramUserId
			) {
				throw new Error('Öğrenme kaynakları mevcut Telegram kullanıcısına ait değil.');
			}
			const learningContext = buildPublicationLearningContext({
				jobs,
				publicationJob,
				sourceJob,
				finalArticle,
				memorySnapshot: dynamicEditorialMemory,
			});
			const learning = await runCodexLearning(config, job, learningContext, {
				signal,
				onExecution: recordExecution,
			});
			let proposal = null;
			if (learning.result.outcome === 'proposal') {
				const created = await memoryStore.createProposal({
					publicationJobId: publicationJob.id,
					postId: sourceJob.result.postId,
					sourceJobIds: learningContext.revisionChain.map((entry) => entry.jobId),
					text: learning.result.proposal.text,
					rationale: learning.result.proposal.rationale,
					evidence: learning.result.proposal.evidence,
				});
				proposal = created.proposal;
			}
			const learningResult = {
				status: 'completed',
				jobId: job.id,
				outcome: learning.result.outcome,
				reason: learning.result.reason,
				proposal,
			};
			await setPublicationLearningState(store, publicationJob.id, learningResult);
			const learningCompletedAt = new Date().toISOString();
			const completed = await store.update(job.id, {
				status: 'completed',
				completedAt: learningCompletedAt,
				threadId: learning.threadId,
				result: {
					kind: 'learning',
					publicationJobId: publicationJob.id,
					publicationTitle: publicationJob.result.title,
					publicationUrl: publicationJob.result.url,
					...learningResult,
				},
				error: null,
				notification: createPendingNotification(learningCompletedAt),
				progress: {
					stage: 'completed',
					message: proposal ? 'Editoryal hafıza önerisi hazır.' : 'Yeni editoryal hafıza önerisi gerekmedi.',
					updatedAt: learningCompletedAt,
				},
			});
			await deliverJobNotification(completed.id);

			return;
		}
		let executionJob = { ...job, dynamicEditorialMemory };
		let editedDraft = null;
		if (job.type === 'edit') {
			signal.throwIfAborted();
			await store.update(job.id, {
				progress: {
					stage: 'loading-draft',
					message: 'Düzenlenecek taslak Directus’tan alınıyor.',
					updatedAt: new Date().toISOString(),
				},
			});
			const sourceJob = await store.get(job.targetJobId);
			if (!sourceJob || sourceJob.status !== 'completed' || !sourceJob.result?.postId || !sourceJob.result?.slug) {
				throw new Error('Düzenlenebilir tamamlanmış bir yazı işi bulunamadı.');
			}
			if (sourceJob.telegramChatId !== job.telegramChatId || sourceJob.telegramUserId !== job.telegramUserId) {
				throw new Error('Bu yazı işi mevcut Telegram kullanıcısına ait değil.');
			}
			editedDraft = await getDirectusDraftForEdit(config, sourceJob.result.postId);
			executionJob = {
				...executionJob,
				existingArticle: {
					title: editedDraft.title,
					slug: editedDraft.slug,
					description: editedDraft.description,
					content: editedDraft.content,
					seo: editedDraft.seo,
				},
			};
		}
		await store.update(job.id, {
			progress: {
				stage: 'loading-context',
				message: 'Editoryal hafıza ve yakın tarihli yazılar alınıyor.',
				updatedAt: new Date().toISOString(),
			},
		});
		const editorialContext = await getEditorialContext(config).catch((error) => {
			console.error('Editorial context error:', error instanceof Error ? error.message : String(error));

			return { fetchedAt: new Date().toISOString(), recentArticles: [], unavailable: true };
		});
		await store.update(job.id, {
			progress: {
				stage: 'generating',
				message: job.type === 'ideas' ? 'Codex fikirleri araştırıyor.' : 'Codex yazıyı hazırlıyor ve doğruluyor.',
				updatedAt: new Date().toISOString(),
			},
		});
		let generated = await runCodexJob(config, executionJob, editorialContext, {
			signal,
			onExecution: recordExecution,
		});
		if (job.type === 'ideas') {
			const ideasCompletedAt = new Date().toISOString();
			const completed = await store.update(job.id, {
				status: 'completed',
				completedAt: ideasCompletedAt,
				threadId: generated.threadId,
				result: {
					kind: 'ideas',
					...generated.result,
					usage: generated.usage,
					editorialMemoryVersion: generated.editorialMemoryVersion,
				},
				error: null,
				notification: createPendingNotification(ideasCompletedAt),
				progress: {
					stage: 'completed',
					message: 'Fikir araştırması tamamlandı.',
					updatedAt: ideasCompletedAt,
				},
			});
			await deliverJobNotification(completed.id);

			return;
		}
		const qualityResult = await runArticleQualityGate({
			enabled: config.codexQualityReviewEnabled,
			initialGeneration: generated,
			job: executionJob,
			editorialContext,
			runReview: (reviewJob, article, context, attempt) =>
				runCodexReview(config, reviewJob, article, context, { attempt, signal, onExecution: recordExecution }),
			runRevision: (revisionJob, article, review, context) =>
				runCodexJob(
					config,
					{
						...revisionJob,
						existingArticle: article,
						qualityReview: review,
					},
					context,
					{ signal, onExecution: recordExecution },
				),
			onProgress: (stage, message) =>
				store.update(job.id, {
					progress: { stage, message, updatedAt: new Date().toISOString() },
				}),
		});
		generated = qualityResult.generated;
		signal.throwIfAborted();
		const saving = await store.mutate(job.id, (current) => {
			if (current.status !== 'running' || signal.aborted) return null;
			return {
				progress: {
					stage: 'saving-draft',
					message: 'Doğrulanan içerik Directus taslağına kaydediliyor.',
					updatedAt: new Date().toISOString(),
				},
			};
		});
		if (saving.status !== 'running' || saving.progress?.stage !== 'saving-draft') throw cancelledError();
		signal.throwIfAborted();
		const draft = editedDraft
			? await updateDirectusDraft(config, editedDraft.id, editedDraft.slug, generated.result)
			: await createDirectusDraft(config, generated.result);
		const articleCompletedAt = new Date().toISOString();
		const completed = await store.update(job.id, {
			status: 'completed',
			completedAt: articleCompletedAt,
			threadId: generated.threadId,
			result: {
				kind: 'article',
				...(job.type === 'edit' ? { revisedFromJobId: job.targetJobId } : {}),
				title: generated.result.title,
				slug: draft.slug,
				postId: draft.id,
				previewUrl: draft.previewUrl,
				readTime: generated.result.readTime,
				warnings: generated.result.warnings,
				sources: generated.result.sources,
				usage: generated.usage,
				editorialMemoryVersion: generated.editorialMemoryVersion,
				quality: qualityResult.review
					? {
							gate: 'passed',
							summary: qualityResult.review.result.summary,
							issues: qualityResult.review.result.issues,
							minorIssueCount: qualityResult.review.result.issues.filter((issue) => issue.severity === 'minor').length,
							revisionCount: qualityResult.revisionCount,
						}
					: null,
			},
			error: null,
			notification: createPendingNotification(articleCompletedAt),
			progress: {
				stage: 'completed',
				message: 'Taslak hazır.',
				updatedAt: articleCompletedAt,
			},
		});
		await deliverJobNotification(completed.id);
	} catch (error) {
		const current = await store.get(job.id);
		const now = new Date().toISOString();
		if (job.type === 'learning') {
			const message = String(error instanceof Error ? error.message : error).slice(0, 1_000);
			const learningResult = { status: 'failed', jobId: job.id, error: message };
			await setPublicationLearningState(store, job.targetJobId, learningResult).catch((publicationError) => {
				console.error(
					'Could not update publication learning state:',
					publicationError instanceof Error ? publicationError.message : String(publicationError),
				);
			});
			const cancelled = error?.name === 'AbortError' || current?.status === 'cancelling';
			const failedLearning = await store.update(job.id, {
				status: cancelled ? 'cancelled' : 'failed',
				cancelledAt: cancelled ? now : current?.cancelledAt || null,
				completedAt: now,
				failureStage: current?.progress?.stage || 'learning',
				result: { kind: 'learning', publicationJobId: job.targetJobId, ...learningResult },
				error: message,
				notification: createPendingNotification(now),
				progress: {
					stage: cancelled ? 'cancelled' : 'failed',
					message: 'Yayın sonrası editoryal öğrenme tamamlanamadı; yayın etkilenmedi.',
					updatedAt: now,
				},
			});
			await deliverJobNotification(failedLearning.id);
		} else if (error?.name === 'AbortError' || current?.status === 'cancelling') {
			const cancelled = await store.update(job.id, {
				status: 'cancelled',
				cancelledAt: now,
				completedAt: now,
				error: null,
				notification: createPendingNotification(now),
				progress: {
					stage: 'cancelled',
					message: 'İş güvenli biçimde iptal edildi.',
					updatedAt: now,
				},
			});
			await deliverJobNotification(cancelled.id);
		} else {
			const failureStage = current?.progress?.stage || 'running';
			const failed = await store.update(job.id, {
				status: 'failed',
				completedAt: now,
				failureStage,
				error: error instanceof Error ? error.message : String(error),
				notification: createPendingNotification(now),
				progress: {
					stage: 'failed',
					message: 'İş tamamlanamadı.',
					updatedAt: now,
				},
			});
			await deliverJobNotification(failed.id);
		}
	} finally {
		activeJobId = null;
		activeJobController = null;
	}
}

async function workerLoop() {
	while (!stopping) {
		const job = await store.nextQueued();
		if (job) await processJob(job);
		else await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
	}
}

async function runRetention() {
	try {
		const memoryState = await memoryStore.getState();
		const pendingSourceJobIds = memoryState.proposals.flatMap((proposal) =>
			proposal.status === 'pending' ? proposal.sourceJobIds || [] : [],
		);
		const result = await cleanupRetention({
			store,
			workspacesDir: config.workspacesDir,
			pendingSourceJobIds,
			workspaceRetentionDays: config.workspaceRetentionDays,
			jobRetentionDays: config.jobRetentionDays,
			publishedRetentionDays: config.publishedRetentionDays,
		});
		await memoryStore.pruneProposalBodies({ retentionDays: 90 });
		if (result.removedJobs.length || result.removedWorkspaces.length) {
			console.log(
				`Retention cleanup removed ${result.removedJobs.length} job files and ${result.removedWorkspaces.length} workspaces.`,
			);
		}
	} catch (error) {
		console.error('Retention cleanup failed:', error instanceof Error ? error.message : String(error));
	}
}

const server = http.createServer(async (request, response) => {
	try {
		const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
		if (request.method === 'GET' && url.pathname === '/health') {
			const editorialMemory = await memoryStore.health();
			return sendJson(response, editorialMemory.ok ? 200 : 503, {
				ok: editorialMemory.ok,
				activeJobId,
				editorialMemory: {
					ok: editorialMemory.ok,
					code: editorialMemory.ok ? null : editorialMemory.code,
					activeRuleCount: editorialMemory.activeRuleCount ?? null,
					pendingProposalCount: editorialMemory.pendingProposalCount ?? null,
				},
			});
		}
		if (!authorized(request)) return sendJson(response, 401, { error: 'Unauthorized.' });
		if (request.method === 'POST' && url.pathname === '/v1/operations/check') {
			const result = await operationsMonitor.check({
				jobs: await store.list(),
				memoryHealth: await memoryStore.health(),
			});

			return sendJson(response, 200, { ...result, telegramChatId: config.telegramAllowedChatId });
		}
		if (request.method === 'POST' && url.pathname === '/v1/operations/ack') {
			const body = await readJson(request);
			if (!Array.isArray(body.notificationIds)) throw new Error('notificationIds must be an array.');
			const result = await operationsMonitor.ack(body.notificationIds);

			return sendJson(response, 200, result);
		}

		if (request.method === 'POST' && url.pathname === '/v1/jobs') {
			let input;
			try {
				input = validateSubmission(await readJson(request));
			} catch (error) {
				if (error instanceof TelegramCommandError) {
					return sendJson(response, 200, { immediateResponse: true, message: formatTelegramCommandError(error) });
				}
				throw error;
			}
			let resolution;
			try {
				resolution = await resolveTelegramJobCommand({
					input,
					store,
					memoryStore,
					contentProfile: config.contentProfile,
					abortJob: (jobId) => {
						if (activeJobId !== jobId || !activeJobController) return false;
						activeJobController.abort();
						return true;
					},
				});
			} catch (error) {
				return sendJson(response, 200, {
					immediateResponse: true,
					message: `İstek uygulanamadı: ${String(error instanceof Error ? error.message : error).slice(0, 1000)}`,
				});
			}
			if (resolution.kind === 'immediate') return sendJson(response, 200, resolution.body);
			const result = await store.create(resolution.input);

			return sendJson(response, result.created ? 202 : 200, {
				created: result.created,
				job: publicJob(result.job),
			});
		}

		const match = url.pathname.match(/^\/v1\/jobs\/([a-f0-9-]+)$/);
		if (request.method === 'GET' && match) {
			const job = await store.get(match[1]);

			return job ? sendJson(response, 200, { job: publicJob(job) }) : sendJson(response, 404, { error: 'Not found.' });
		}

		return sendJson(response, 404, { error: 'Not found.' });
	} catch (error) {
		return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
	}
});

await Promise.all([store.init(), mkdir(config.workspacesDir, { recursive: true }), memoryStore.health()]);
await store.recoverInterrupted(config.maxAttempts);
await reconcilePublicationLearningJobs(store).catch((error) => {
	console.error('Publication learning reconciliation failed:', error instanceof Error ? error.message : String(error));
});
await runRetention();
await flushCallbackOutbox();
setInterval(runRetention, config.cleanupIntervalMs).unref();
setInterval(flushCallbackOutbox, 10_000).unref();
server.listen(config.port, '0.0.0.0', () => {
	console.log(`Codex content worker listening on port ${config.port}.`);
});
workerLoop().catch((error) => {
	console.error('Worker loop failed:', error);
	process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		stopping = true;
		server.close(() => process.exit(0));
	});
}

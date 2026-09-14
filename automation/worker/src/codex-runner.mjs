import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateArticle } from './article.mjs';
import { contentProfileFor } from './content-profile.mjs';
import { finishExecution, startExecution } from './execution-metrics.mjs';
import { validateIdeas } from './ideas.mjs';
import { validateLearningResult } from './learning.mjs';
import { validateQualityReview } from './quality-review.mjs';

const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 512 * 1024;

function redactDiagnostic(value) {
	return String(value || '')
		.replace(/(bearer\s+)[a-z0-9._~+\/-]+/giu, '$1[REDACTED]')
		.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[REDACTED]@')
		.replace(/\bsk-[a-z0-9_-]{16,}\b/giu, '[REDACTED_API_KEY]');
}

function safeChildEnvironment(env = process.env) {
	const names = [
		'PATH',
		'HOME',
		'USER',
		'LOGNAME',
		'LANG',
		'LC_ALL',
		'TERM',
		'TMPDIR',
		'CODEX_HOME',
		'SSL_CERT_FILE',
		'CODEX_CA_CERTIFICATE',
		'HTTP_PROXY',
		'HTTPS_PROXY',
		'NO_PROXY',
	];

	return Object.fromEntries(names.flatMap((name) => (env[name] ? [[name, env[name]]] : [])));
}

function runProcess(command, args, options) {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			const error = new Error('Codex execution was cancelled.');
			error.name = 'AbortError';
			error.code = 'ABORT_ERR';
			return reject(error);
		}
		const detached = process.platform !== 'win32';
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
			shell: false,
			detached,
		});
		let stdout = '';
		let stderr = '';
		let aborted = false;
		let timedOut = false;
		let outputExceeded = false;
		let settled = false;
		let forceKillTimer = null;
		const signalProcessGroup = (signal) => {
			try {
				if (detached && child.pid) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch (error) {
				if (error?.code !== 'ESRCH') throw error;
			}
		};
		const terminate = () => {
			signalProcessGroup('SIGTERM');
			forceKillTimer ||= setTimeout(() => signalProcessGroup('SIGKILL'), 5_000);
			forceKillTimer.unref();
		};
		const cleanup = () => {
			clearTimeout(timer);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			options.signal?.removeEventListener('abort', abort);
		};
		const abort = () => {
			aborted = true;
			terminate();
		};
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, options.timeoutMs);
		options.signal?.addEventListener('abort', abort, { once: true });
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
			options.onStdout?.(chunk.toString());
			if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES && !outputExceeded) {
				outputExceeded = true;
				terminate();
			}
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
			if (Buffer.byteLength(stderr) > MAX_STDERR_BYTES && !outputExceeded) {
				outputExceeded = true;
				terminate();
			}
		});
		if (options.input) child.stdin.end(options.input);
		child.on('error', (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		});
		child.on('close', (code, signal) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (aborted) {
				const error = new Error('Codex execution was cancelled.');
				error.name = 'AbortError';
				error.code = 'ABORT_ERR';
				error.exitCode = code;
				error.exitSignal = signal;
				error.stdout = stdout;
				error.stderr = stderr;
				return reject(error);
			}
			if (timedOut || outputExceeded) {
				const error = new Error(
					timedOut
						? `${command} exceeded its ${options.timeoutMs}ms timeout.`
						: `${command} exceeded the allowed diagnostic output size.`,
				);
				error.code = timedOut ? 'PROCESS_TIMEOUT' : 'PROCESS_OUTPUT_LIMIT';
				error.exitCode = code;
				error.exitSignal = signal;
				error.stdout = stdout.slice(-MAX_STDOUT_BYTES);
				error.stderr = stderr.slice(-MAX_STDERR_BYTES);
				return reject(error);
			}
			if (code === 0) return resolve({ code, signal, stdout, stderr });
			const structuredError = extractStructuredError(stdout);
			const diagnostic = redactDiagnostic(stderr.trim() || structuredError || 'No diagnostic was emitted.').slice(
				-4000,
			);
			const error = new Error(
				`${command} exited with code ${code ?? 'null'} (${signal || 'no signal'}): ${diagnostic}`,
			);
			error.exitCode = code;
			error.exitSignal = signal;
			error.stdout = stdout;
			error.stderr = stderr;
			reject(error);
		});
	});
}

async function emitExecution(handler, execution) {
	if (!handler) return;
	try {
		await handler(execution);
	} catch (error) {
		console.error('Execution metrics error:', error instanceof Error ? error.message : String(error));
	}
}

function extractStructuredError(stdout) {
	const messages = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === 'error' && event.message) messages.push(event.message);
			if (event.type === 'turn.failed' && event.error?.message) messages.push(event.error.message);
		} catch {
			// Raw stdout can contain article content, so only recognized structured errors are surfaced.
		}
	}

	return messages
		.flatMap((message) => {
			const sanitizedMessage = String(message)
				.replace(/[\u0000-\u001f\u007f]/g, ' ')
				.trim();

			return sanitizedMessage ? [sanitizedMessage] : [];
		})
		.at(-1);
}

function parseEvents(text) {
	let threadId = null;
	let usage = null;
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === 'thread.started') threadId = event.thread_id;
			if (event.type === 'turn.completed') usage = event.usage || null;
		} catch {
			// Keep malformed diagnostic lines in the raw log; they are not control data.
		}
	}

	return { threadId, usage };
}

function inspectEventStream(text) {
	let latestAgentMessage = null;
	let completedAgentMessage = null;
	let completed = false;
	let failed = false;
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
				latestAgentMessage = event.item.text;
			}
			if (event.type === 'turn.completed') {
				completed = true;
				completedAgentMessage = latestAgentMessage;
			}
			if (event.type === 'turn.failed' || event.type === 'error') failed = true;
		} catch {
			// Ignore non-event diagnostic lines.
		}
	}

	return { completed, failed, completedAgentMessage };
}

async function runCodexProcess(command, args, options) {
	try {
		return await runProcess(command, args, options);
	} catch (error) {
		const events = error?.stdout ? inspectEventStream(error.stdout) : null;
		if (
			error?.exitSignal ||
			!Number.isInteger(error?.exitCode) ||
			error.exitCode === 0 ||
			!events?.completed ||
			events.failed
		) {
			throw error;
		}

		return {
			code: error.exitCode,
			signal: null,
			stdout: error.stdout,
			stderr: error.stderr,
			recoveredNonZeroExit: true,
			recoveryError: error,
		};
	}
}

async function readStructuredResult(outputFile, execution) {
	if (!execution.recoveredNonZeroExit) return JSON.parse(await readFile(outputFile, 'utf8'));

	const { completed, failed, completedAgentMessage } = inspectEventStream(execution.stdout);
	if (!completed || failed || !completedAgentMessage) throw execution.recoveryError;

	try {
		return JSON.parse(completedAgentMessage);
	} catch (parseError) {
		execution.recoveryError.cause = parseError;
		throw execution.recoveryError;
	}
}

function codexConfigArgs(model, reasoningEffort) {
	return ['-c', `model_reasoning_effort="${reasoningEffort}"`, ...(model ? ['-c', `model="${model}"`] : [])];
}

function memoryVersion(editorialMemory) {
	return createHash('sha256').update(editorialMemory).digest('hex').slice(0, 12);
}

function editorialArticleView(article) {
	if (!article || typeof article !== 'object') return article ?? null;
	const { readTime: _systemCalculatedReadTime, ...authoredFields } = article;
	return authoredFields;
}

export async function runCodexJob(config, job, editorialContext, { signal, onExecution } = {}) {
	const contentProfile = contentProfileFor(config);
	const isIdeaResearch = job.type === 'ideas';
	const isQualityRevision = Boolean(job.qualityReview);
	const workspace = path.join(config.workspacesDir, job.id);
	await mkdir(workspace, { recursive: true });
	const instructionsFile = isIdeaResearch
		? contentProfile.templates.ideaInstructions
		: contentProfile.templates.articleInstructions;
	const schemaFile = isIdeaResearch ? contentProfile.templates.ideaSchema : contentProfile.templates.articleSchema;
	const schemaName = path.basename(schemaFile);
	const [instructions, editorialInstructions, editorialMemory, schema] = await Promise.all([
		readFile(instructionsFile, 'utf8'),
		readFile(contentProfile.templates.editorialContext, 'utf8'),
		readFile(contentProfile.templates.editorialMemory, 'utf8'),
		readFile(schemaFile, 'utf8'),
	]);
	const effectiveEditorialMemory = [
		editorialMemory.trim(),
		job.dynamicEditorialMemory?.content
			? `## Telegram'da onaylanmış dinamik kurallar\n${job.dynamicEditorialMemory.content}`
			: '',
	]
		.filter(Boolean)
		.join('\n\n');
	await Promise.all([
		writeFile(path.join(workspace, 'AGENTS.md'), instructions, { mode: 0o600 }),
		writeFile(path.join(workspace, 'EDITORIAL_CONTEXT.md'), editorialInstructions, { mode: 0o600 }),
		writeFile(path.join(workspace, 'EDITORIAL_MEMORY.md'), effectiveEditorialMemory, { mode: 0o600 }),
		writeFile(path.join(workspace, schemaName), schema, { mode: 0o600 }),
		writeFile(path.join(workspace, 'site-context.json'), `${JSON.stringify(editorialContext, null, 2)}\n`, {
			mode: 0o600,
		}),
		writeFile(
			path.join(workspace, 'job.json'),
			`${JSON.stringify(
				{
					request: job.prompt,
					jobId: job.id,
					requestedAt: job.createdAt,
					language: contentProfile.publication.language,
					authorVoice: contentProfile.publication.authorVoice,
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		),
	]);
	await runProcess('git', ['init', '--quiet'], {
		cwd: workspace,
		env: safeChildEnvironment(),
		timeoutMs: 30_000,
	});

	const suffix = isQualityRevision ? '-revision' : '';
	const outputFile = path.join(workspace, isIdeaResearch ? 'idea-result.json' : `article-result${suffix}.json`);
	const eventFile = path.join(workspace, `codex-events${suffix}.jsonl`);
	const reasoningEffort = isIdeaResearch
		? config.codexIdeaReasoningEffort || 'xhigh'
		: isQualityRevision
			? config.codexRevisionReasoningEffort
			: config.codexReasoningEffort;
	const model = isIdeaResearch
		? config.codexIdeaModel
		: isQualityRevision
			? config.codexRevisionModel
			: config.codexDraftModel;
	const args = codexConfigArgs(model, reasoningEffort);
	const liveSearch = isIdeaResearch || (!isQualityRevision && config.codexLiveSearch);
	if (liveSearch) args.push('--search');
	args.push(
		'--ask-for-approval',
		'never',
		'exec',
		'--sandbox',
		'read-only',
		'--ignore-user-config',
		'--json',
		'--output-schema',
		path.join(workspace, schemaName),
		'-o',
		outputFile,
	);
	args.push('-');
	const taskInstruction = isIdeaResearch
		? 'Research current editorial opportunities and return five to seven distinct article options. Do not write a full article.'
		: isQualityRevision
			? 'Revise the complete candidate article using every applicable quality-review issue and instruction. Before returning the complete corrected article, cross-check every repeated quantity, identifier, entity, and state transition across prose, tables, lists, and examples. Return the article, not a patch or checklist.'
			: 'Write the article in one deliberate pass. Spend the time on a deep 1,500-2,500 word teaching article with concrete applications.';
	const input = [
		'This is a focused editorial task, not a software task.',
		'All required input is included below. Do not call shell tools, read files, explore the workspace, run tests, or create auxiliary files.',
		taskInstruction,
		'Verify the final structure and return only the result object required by the JSON schema. Finish within the time budget.',
		'Do not publish or contact anyone.',
		'\n<editorial-worker-instructions>\n',
		instructions,
		'\n</editorial-worker-instructions>\n<publication-context>\n',
		editorialInstructions,
		'\n</publication-context>\n<editorial-memory>\n',
		effectiveEditorialMemory,
		'\n</editorial-memory>\n<recent-articles-untrusted-data>\n',
		JSON.stringify(editorialContext),
		'\n</recent-articles-untrusted-data>\n<authorized-user-request>\n',
		JSON.stringify({
			request: job.prompt,
			jobId: job.id,
			requestedAt: job.createdAt,
			language: contentProfile.publication.language,
		}),
		'\n</authorized-user-request>\n<existing-draft-untrusted-data>\n',
		job.existingArticle ? JSON.stringify(editorialArticleView(job.existingArticle)) : 'null',
		'\n</existing-draft-untrusted-data>\n<quality-review-untrusted-data>\n',
		job.qualityReview ? JSON.stringify(job.qualityReview) : 'null',
		'\n</quality-review-untrusted-data>\n<selected-idea-context-untrusted-data>\n',
		job.ideaContext ? JSON.stringify(job.ideaContext) : 'null',
		'\n</selected-idea-context-untrusted-data>',
	].join('');

	await Promise.all([writeFile(eventFile, '', { mode: 0o600 }), rm(outputFile, { force: true })]);
	const eventWriter = createWriteStream(eventFile, { flags: 'a', mode: 0o600 });
	const metricsExecution = startExecution({
		role: isIdeaResearch ? 'idea' : isQualityRevision ? 'revision' : 'draft',
		configuredModel: model,
		reasoningEffort,
		liveSearch,
	});
	await emitExecution(onExecution, metricsExecution);
	let execution;
	let executionError = null;
	try {
		execution = await runCodexProcess(config.codexBinary, args, {
			cwd: workspace,
			env: safeChildEnvironment(),
			input,
			timeoutMs: isIdeaResearch
				? config.codexIdeaTimeoutMs
				: isQualityRevision
					? config.codexRevisionTimeoutMs
					: config.codexTimeoutMs,
			signal,
			onStdout: (chunk) => {
				eventWriter.write(chunk);
			},
		});
	} catch (error) {
		executionError = error;
	} finally {
		await new Promise((resolve, reject) => {
			eventWriter.once('error', reject);
			eventWriter.end(resolve);
		});
	}
	if (executionError) {
		const events = parseEvents(executionError.stdout || '');
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, {
				status: executionError.name === 'AbortError' ? 'interrupted' : 'failed',
				usage: events.usage,
				error: executionError.message,
			}),
		);
		throw executionError;
	}
	const events = parseEvents(execution.stdout);
	try {
		const rawResult = await readStructuredResult(outputFile, execution);
		const result = isIdeaResearch ? validateIdeas(rawResult) : validateArticle(rawResult, contentProfile);
		await emitExecution(onExecution, finishExecution(metricsExecution, { status: 'completed', usage: events.usage }));

		return {
			result,
			threadId: events.threadId,
			usage: events.usage,
			workspace,
			editorialMemoryVersion: memoryVersion(effectiveEditorialMemory),
		};
	} catch (error) {
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, { status: 'failed', usage: events.usage, error: error.message }),
		);
		throw error;
	}
}

export async function runCodexReview(
	config,
	job,
	article,
	editorialContext,
	{ attempt = 1, signal, onExecution } = {},
) {
	const contentProfile = contentProfileFor(config);
	const workspace = path.join(config.workspacesDir, job.id);
	await mkdir(workspace, { recursive: true });
	const [reviewInstructions, editorialInstructions, editorialMemory, schema] = await Promise.all([
		readFile(contentProfile.templates.qualityReview, 'utf8'),
		readFile(contentProfile.templates.editorialContext, 'utf8'),
		readFile(contentProfile.templates.editorialMemory, 'utf8'),
		readFile(contentProfile.templates.qualityReviewSchema, 'utf8'),
	]);
	const effectiveEditorialMemory = [
		editorialMemory.trim(),
		job.dynamicEditorialMemory?.content
			? `## Telegram'da onaylanmış dinamik kurallar\n${job.dynamicEditorialMemory.content}`
			: '',
	]
		.filter(Boolean)
		.join('\n\n');
	const schemaFile = path.join(workspace, 'quality-review.schema.json');
	const outputFile = path.join(workspace, `quality-review-${attempt}.json`);
	const eventFile = path.join(workspace, `quality-review-events-${attempt}.jsonl`);
	await writeFile(schemaFile, schema, { mode: 0o600 });

	const args = codexConfigArgs(config.codexReviewModel, config.codexReviewReasoningEffort);
	args.push(
		'--ask-for-approval',
		'never',
		'exec',
		'--sandbox',
		'read-only',
		'--ignore-user-config',
		'--json',
		'--output-schema',
		schemaFile,
		'-o',
		outputFile,
		'-',
	);
	const input = [
		'This is an independent editorial quality review. Do not write or publish the article.',
		'Return only the review object required by the JSON schema. Do not call shell tools or read workspace files.',
		'System-calculated publication metadata such as reading time is intentionally excluded. Review only the authored fields provided.',
		'\n<quality-reviewer-instructions>\n',
		reviewInstructions,
		'\n</quality-reviewer-instructions>\n<publication-context>\n',
		editorialInstructions,
		'\n</publication-context>\n<editorial-memory>\n',
		effectiveEditorialMemory,
		'\n</editorial-memory>\n<authorized-user-request>\n',
		JSON.stringify({ request: job.prompt, jobId: job.id, language: contentProfile.publication.language }),
		'\n</authorized-user-request>\n<recent-articles-untrusted-data>\n',
		JSON.stringify(editorialContext),
		'\n</recent-articles-untrusted-data>\n<candidate-article-untrusted-data>\n',
		JSON.stringify(editorialArticleView(article)),
		'\n</candidate-article-untrusted-data>',
	].join('');

	await Promise.all([writeFile(eventFile, '', { mode: 0o600 }), rm(outputFile, { force: true })]);
	const eventWriter = createWriteStream(eventFile, { flags: 'a', mode: 0o600 });
	const metricsExecution = startExecution({
		role: 'review',
		configuredModel: config.codexReviewModel,
		reasoningEffort: config.codexReviewReasoningEffort,
		liveSearch: false,
	});
	await emitExecution(onExecution, metricsExecution);
	let execution;
	let executionError = null;
	try {
		execution = await runCodexProcess(config.codexBinary, args, {
			cwd: workspace,
			env: safeChildEnvironment(),
			input,
			timeoutMs: config.codexReviewTimeoutMs,
			signal,
			onStdout: (chunk) => eventWriter.write(chunk),
		});
	} catch (error) {
		executionError = error;
	} finally {
		await new Promise((resolve, reject) => {
			eventWriter.once('error', reject);
			eventWriter.end(resolve);
		});
	}
	if (executionError) {
		const events = parseEvents(executionError.stdout || '');
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, {
				status: executionError.name === 'AbortError' ? 'interrupted' : 'failed',
				usage: events.usage,
				error: executionError.message,
			}),
		);
		throw executionError;
	}
	const events = parseEvents(execution.stdout);
	try {
		const rawResult = await readStructuredResult(outputFile, execution);
		const result = validateQualityReview(rawResult);
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, { status: 'completed', usage: events.usage, review: result }),
		);

		return {
			result,
			threadId: events.threadId,
			usage: events.usage,
			editorialMemoryVersion: memoryVersion(effectiveEditorialMemory),
		};
	} catch (error) {
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, { status: 'failed', usage: events.usage, error: error.message }),
		);
		throw error;
	}
}

export async function runCodexLearning(config, publicationJob, learningContext, { signal, onExecution } = {}) {
	const contentProfile = contentProfileFor(config);
	const workspace = path.join(config.workspacesDir, publicationJob.id, 'learning');
	await mkdir(workspace, { recursive: true });
	const [instructions, schema] = await Promise.all([
		readFile(contentProfile.templates.learning, 'utf8'),
		readFile(contentProfile.templates.learningSchema, 'utf8'),
	]);
	const schemaFile = path.join(workspace, 'learning-result.schema.json');
	const outputFile = path.join(workspace, 'learning-result.json');
	const eventFile = path.join(workspace, 'learning-events.jsonl');
	await Promise.all([
		writeFile(path.join(workspace, 'AGENTS.md'), instructions, { mode: 0o600 }),
		writeFile(schemaFile, schema, { mode: 0o600 }),
		writeFile(eventFile, '', { mode: 0o600 }),
		rm(outputFile, { force: true }),
	]);
	await runProcess('git', ['init', '--quiet'], {
		cwd: workspace,
		env: safeChildEnvironment(),
		timeoutMs: 30_000,
	});
	const args = codexConfigArgs(config.codexLearningModel, config.codexLearningReasoningEffort);
	args.push(
		'--ask-for-approval',
		'never',
		'exec',
		'--sandbox',
		'read-only',
		'--ignore-user-config',
		'--json',
		'--output-schema',
		schemaFile,
		'-o',
		outputFile,
		'-',
	);
	const input = [
		'This is an isolated post-publication editorial learning review.',
		'Do not call shell tools, read workspace files, use search, publish, or contact anyone.',
		'Return only the object required by the JSON schema. At most one proposal is allowed.',
		'\n<learning-reviewer-instructions>\n',
		instructions,
		'\n</learning-reviewer-instructions>\n<publication-chain-untrusted-data>\n',
		JSON.stringify(learningContext),
		'\n</publication-chain-untrusted-data>',
	].join('');
	const metricsExecution = startExecution({
		role: 'learning',
		configuredModel: config.codexLearningModel,
		reasoningEffort: config.codexLearningReasoningEffort,
		liveSearch: false,
	});
	await emitExecution(onExecution, metricsExecution);
	const eventWriter = createWriteStream(eventFile, { flags: 'a', mode: 0o600 });
	let execution;
	let executionError = null;
	try {
		execution = await runCodexProcess(config.codexBinary, args, {
			cwd: workspace,
			env: safeChildEnvironment(),
			input,
			timeoutMs: config.codexLearningTimeoutMs,
			signal,
			onStdout: (chunk) => eventWriter.write(chunk),
		});
	} catch (error) {
		executionError = error;
	} finally {
		await new Promise((resolve, reject) => {
			eventWriter.once('error', reject);
			eventWriter.end(resolve);
		});
	}
	if (executionError) {
		const events = parseEvents(executionError.stdout || '');
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, {
				status: executionError.name === 'AbortError' ? 'interrupted' : 'failed',
				usage: events.usage,
				error: executionError.message,
			}),
		);
		throw executionError;
	}
	const events = parseEvents(execution.stdout);
	try {
		const rawResult = await readStructuredResult(outputFile, execution);
		const result = validateLearningResult(rawResult);
		await emitExecution(onExecution, finishExecution(metricsExecution, { status: 'completed', usage: events.usage }));

		return { result, threadId: events.threadId, usage: events.usage, workspace };
	} catch (error) {
		await emitExecution(
			onExecution,
			finishExecution(metricsExecution, { status: 'failed', usage: events.usage, error: error.message }),
		);
		throw error;
	}
}

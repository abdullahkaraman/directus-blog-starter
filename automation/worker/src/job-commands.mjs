import { aggregateJobMetrics, formatJobMetrics, formatMetricsSummary } from './execution-metrics.mjs';
import { isOwnedBy, resolveJobStatus } from './job-status.mjs';
import { createSentNotification } from './callback-outbox.mjs';
import { formatTelegramHelp, immediateResponse } from './telegram-commands.mjs';

const TERMINAL_RETRY_STATUSES = new Set(['failed', 'cancelled']);
const UNSAFE_RETRY_STAGES = new Set(['saving-draft', 'publishing']);
const JOB_TYPE_LABELS = {
	article: 'Yazı',
	ideas: 'Fikir',
	edit: 'Düzenleme',
	publish: 'Yayın',
};
const STATUS_LABELS = {
	queued: 'sırada',
	running: 'çalışıyor',
	cancelling: 'iptal ediliyor',
	cancelled: 'iptal edildi',
	completed: 'tamamlandı',
	failed: 'başarısız',
};

function owned(job, input) {
	return isOwnedBy(job, input.telegramChatId, input.telegramUserId);
}

function response(message) {
	return { kind: 'immediate', body: immediateResponse(message) };
}

function enqueue(input) {
	return { kind: 'enqueue', input };
}

function clone(value) {
	return structuredClone(value);
}

async function jobWithLinkedLearningMetrics(store, publicationJob, input) {
	const learningJobId = publicationJob.type === 'publish' ? publicationJob.result?.learning?.jobId : null;
	if (!learningJobId) return publicationJob;

	const learningJob = await store.get(learningJobId);
	if (
		!learningJob?.internal ||
		learningJob.type !== 'learning' ||
		learningJob.targetJobId !== publicationJob.id ||
		!owned(learningJob, input)
	) {
		return publicationJob;
	}

	return {
		...publicationJob,
		metrics: {
			...(publicationJob.metrics || {}),
			executions: [
				...(Array.isArray(publicationJob.metrics?.executions) ? publicationJob.metrics.executions : []),
				...(Array.isArray(learningJob.metrics?.executions) ? learningJob.metrics.executions : []),
			],
		},
	};
}

function formatRecentJobs(jobs) {
	if (!jobs.length) return 'Henüz kayıtlı bir iş yok.';
	const lines = ['Son işler', ''];
	for (const job of jobs) {
		const title = job.result?.title ? ` — ${String(job.result.title).slice(0, 90)}` : '';
		lines.push(`• ${JOB_TYPE_LABELS[job.type] || job.type}: ${STATUS_LABELS[job.status] || job.status}${title}`);
		lines.push(`  ${job.id}`);
	}
	return lines.join('\n');
}

function formatMemory(state) {
	const pending = state.proposals.filter((proposal) => proposal.status === 'pending');
	const active = state.rules.filter((rule) => rule.status === 'active');
	const lines = ['Editoryal hafıza', '', `Onay bekleyen: ${pending.length}`, `Etkin kural: ${active.length}`];
	if (pending.length) {
		lines.push('', 'Onay bekleyen öneriler');
		for (const proposal of pending.slice(0, 10)) {
			lines.push(`• ${proposal.id}: ${proposal.text}`);
			lines.push(`  Onayla: /hafiza_onayla ${proposal.id}`);
			lines.push(`  Düzenle: /hafiza_duzenle ${proposal.id} <yeni-kural>`);
			lines.push(`  Reddet: /hafiza_reddet ${proposal.id}`);
		}
	}
	if (active.length) {
		lines.push('', 'Etkin kurallar');
		for (const rule of active.slice(0, 20)) {
			lines.push(`• ${rule.id}: ${rule.text}`);
			lines.push(`  Kaldır: /hafiza_kaldir ${rule.id}`);
		}
	}
	if (!pending.length && !active.length) lines.push('', 'Henüz öneri veya etkin dinamik kural yok.');

	return lines.join('\n').slice(0, 4000);
}

function selectedIdeaInput(input, ideaJob, contentProfile) {
	const index = input.selectedIdeaNumber - 1;
	const option = ideaJob.result.options[index];
	if (!option) return null;
	const ideaContext = {
		theme: ideaJob.result.theme,
		researchSummary: ideaJob.result.researchSummary,
		selectedOption: clone(option),
		sources: clone(ideaJob.result.sources || []),
		researchedAt: ideaJob.completedAt,
		editorialMemoryVersion: ideaJob.result.editorialMemoryVersion || null,
	};

	return {
		...input,
		type: 'article',
		prompt:
			contentProfile?.ideas?.selectionPrompt ||
			'Seçilen fikir bağlamını temel alarak kapsamlı, uygulamalı ve öğretici bir yazı hazırla.',
		sourceIdeaJobId: undefined,
		selectedFromIdeaJobId: ideaJob.id,
		selectedIdeaNumber: input.selectedIdeaNumber,
		ideaContext,
	};
}

function retriedJobInput(input, source) {
	return {
		type: source.type,
		prompt: source.prompt,
		targetJobId: source.targetJobId,
		selectedFromIdeaJobId: source.selectedFromIdeaJobId,
		selectedIdeaNumber: source.selectedIdeaNumber,
		ideaContext: source.ideaContext ? clone(source.ideaContext) : undefined,
		retriedFromJobId: source.id,
		telegramChatId: input.telegramChatId,
		telegramUserId: input.telegramUserId,
		idempotencyKey: input.idempotencyKey,
	};
}

export async function resolveTelegramJobCommand({
	input,
	store,
	memoryStore,
	contentProfile = null,
	abortJob = () => false,
	now = new Date(),
}) {
	switch (input.type) {
		case 'article':
		case 'ideas':
		case 'edit':
			return enqueue(input);
		case 'publish': {
			const source = await store.get(input.targetJobId);
			if (!owned(source, input)) return response('Bu yazı işi sana ait değil veya bulunamadı.');
			const publications = (await store.list()).filter(
				(job) => job.type === 'publish' && job.targetJobId === source.id && owned(job, input),
			);
			if (publications.some((job) => job.idempotencyKey === input.idempotencyKey)) {
				return enqueue(input);
			}
			const existing = publications
				.filter((job) => ['queued', 'running', 'cancelling', 'completed'].includes(job.status))
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
			const publishedUrl = source.result?.publishedUrl || existing?.result?.url;
			if (source.result?.publishedAt || publishedUrl || existing?.status === 'completed') {
				return response(`Bu yazı zaten yayında.${publishedUrl ? `\n\n${publishedUrl}` : ''}`);
			}
			if (existing) {
				return response(
					`Bu yazı için yayın işlemi zaten ${existing.status === 'queued' ? 'sırada' : 'sürüyor'}.\n\nİş no: ${existing.id}\n\nDurumu görmek için:\n/durum ${existing.id}`,
				);
			}

			return enqueue(input);
		}
		case 'select-idea': {
			const source = await store.get(input.sourceIdeaJobId);
			if (!owned(source, input)) return response('Bu fikir işi sana ait değil veya bulunamadı.');
			if (source.type !== 'ideas' || source.status !== 'completed' || source.result?.kind !== 'ideas') {
				return response('Seçim için tamamlanmış bir fikir araştırması gerekli.');
			}
			const selected = selectedIdeaInput(input, source, contentProfile);
			if (!selected) return response(`Seçenek numarası 1-${source.result.options.length} arasında olmalı.`);

			return enqueue(selected);
		}
		case 'status': {
			const result = await resolveJobStatus(store, input, { now });
			return response(result.message);
		}
		case 'recent': {
			const jobs = (await store.list())
				.filter((job) => !job.internal && owned(job, input))
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
				.slice(0, 10);
			return response(formatRecentJobs(jobs));
		}
		case 'retry': {
			const source = await store.get(input.targetJobId);
			if (!owned(source, input)) return response('Bu iş sana ait değil veya bulunamadı.');
			if (source.internal) return response('İç sistem işleri /tekrar komutuyla yeniden başlatılamaz.');
			if (!TERMINAL_RETRY_STATUSES.has(source.status)) {
				return response('Yalnızca başarısız veya iptal edilmiş işler tekrar edilebilir.');
			}
			if (UNSAFE_RETRY_STAGES.has(source.failureStage) || (source.status === 'failed' && !source.failureStage)) {
				return response(
					'Bu işin dış sisteme yazıp yazmadığı güvenle belirlenemediği için otomatik tekrar güvenli değil. Önce Directus durumunu kontrol et.',
				);
			}

			return enqueue(retriedJobInput(input, source));
		}
		case 'cancel': {
			const source = await store.get(input.targetJobId);
			if (!owned(source, input)) return response('Bu iş sana ait değil veya bulunamadı.');
			if (source.status === 'queued') {
				const timestamp = now.toISOString();
				const cancelled = await store.mutate(source.id, (current) => {
					if (current.status !== 'queued') return null;
					return {
						status: 'cancelled',
						cancelRequestedAt: timestamp,
						cancelledAt: timestamp,
						completedAt: timestamp,
						error: null,
						notification: createSentNotification(timestamp, 'immediate'),
						progress: { stage: 'cancelled', message: 'İş kuyruktayken iptal edildi.', updatedAt: timestamp },
					};
				});
				if (
					cancelled.status !== 'cancelled' ||
					cancelled.cancelRequestedAt !== timestamp ||
					cancelled.cancelledAt !== timestamp
				) {
					return response('İşin aşaması değişti; iptal uygulanmadı. /durum ile kontrol et.');
				}
				return response(`İş iptal edildi.\n\nİş no: ${source.id}`);
			}
			if (source.status === 'running') {
				if (UNSAFE_RETRY_STAGES.has(source.progress?.stage)) {
					return response('Bu iş Directus’a yazma aşamasında olduğu için artık güvenli biçimde iptal edilemez.');
				}
				const timestamp = now.toISOString();
				const current = await store.mutate(source.id, (candidate) => {
					if (candidate.status !== 'running' || UNSAFE_RETRY_STAGES.has(candidate.progress?.stage)) return null;
					return {
						status: 'cancelling',
						cancelRequestedAt: timestamp,
						progress: {
							stage: 'cancelling',
							message: 'Çalışan Codex süreci güvenli biçimde durduruluyor.',
							updatedAt: timestamp,
						},
					};
				});
				if (current.status !== 'cancelling')
					return response('İşin aşaması değişti; iptal uygulanmadı. /durum ile kontrol et.');
				abortJob(source.id);
				return response(`İptal isteği alındı.\n\nİş no: ${source.id}`);
			}
			if (source.status === 'cancelling') return response('Bu iş için iptal işlemi zaten sürüyor.');
			if (source.status === 'cancelled') return response('Bu iş zaten iptal edilmiş.');
			return response('Tamamlanmış veya başarısız bir iş iptal edilemez.');
		}
		case 'metrics': {
			if (input.targetJobId) {
				const job = await store.get(input.targetJobId);
				if (!owned(job, input)) return response('Bu iş sana ait değil veya bulunamadı.');
				return response(formatJobMetrics(await jobWithLinkedLearningMetrics(store, job, input)));
			}
			const jobs = (await store.list()).filter((job) => owned(job, input));
			return response(formatMetricsSummary(aggregateJobMetrics(jobs)));
		}
		case 'memory':
			return response(formatMemory(await memoryStore.getState()));
		case 'memory-edit': {
			const proposal = await memoryStore.editProposal(input.proposalId, input.rule);
			return response(`Hafıza önerisi güncellendi.\n\n${proposal.id}: ${proposal.text}`);
		}
		case 'memory-approve': {
			const approved = await memoryStore.approveProposal(input.proposalId);
			return response(`Hafıza kuralı onaylandı ve yeni işlerde etkin.\n\n${approved.rule.id}: ${approved.rule.text}`);
		}
		case 'memory-reject': {
			const proposal = await memoryStore.rejectProposal(input.proposalId);
			return response(`Hafıza önerisi reddedildi.\n\n${proposal.id}`);
		}
		case 'memory-remove': {
			const removed = await memoryStore.removeRule(input.ruleId);
			return response(`Hafıza kuralı kaldırıldı.\n\n${removed.rule.id}`);
		}
		case 'help':
			return response(formatTelegramHelp(contentProfile));
		default:
			return response('Bu komut henüz desteklenmiyor. /yardim ile kullanılabilir komutları görebilirsin.');
	}
}

export { formatMemory, formatRecentJobs };

const JOB_TYPE_LABELS = {
	article: 'Yeni yazı',
	ideas: 'Fikir araştırması',
	edit: 'Taslak düzenleme',
	publish: 'Yayınlama',
};

const STATUS_LABELS = {
	queued: 'Sırada bekliyor',
	running: 'Çalışıyor',
	cancelling: 'İptal ediliyor',
	cancelled: 'İptal edildi',
	completed: 'Tamamlandı',
	failed: 'Başarısız',
};

export function isOwnedBy(job, telegramChatId, telegramUserId) {
	return Boolean(
		job &&
			job.telegramChatId === String(telegramChatId || '') &&
			job.telegramUserId === String(telegramUserId || ''),
	);
}

export async function resolveJobStatus(store, input, { now = new Date() } = {}) {
	const job = await store.get(input.targetJobId);
	if (!isOwnedBy(job, input.telegramChatId, input.telegramUserId)) {
		return {
			found: false,
			message: 'Bu iş numarasıyla sana ait bir kayıt bulunamadı.',
		};
	}

	const jobs = typeof store.list === 'function' ? await store.list() : [job];
	const latestJob = findLatestRevision(jobs, job);
	const queuePosition = await store.queuePosition(latestJob.id);

	return {
		found: true,
		job: latestJob,
		message: formatJobStatus(latestJob, {
			queuePosition,
			now,
			requestedJobId: latestJob.id === job.id ? null : job.id,
		}),
	};
}

function findLatestRevision(jobs, initialJob) {
	let current = initialJob;
	const visited = new Set([current.id]);

	while (true) {
		const currentPostId = current.result?.postId;
		const revisions = jobs
			.filter(
				(candidate) =>
					candidate.status === 'completed' &&
					candidate.type === 'edit' &&
					(candidate.result?.revisedFromJobId === current.id ||
						(Boolean(currentPostId) && candidate.result?.postId === currentPostId)) &&
					candidate.createdAt > current.createdAt &&
					isOwnedBy(candidate, initialJob.telegramChatId, initialJob.telegramUserId) &&
					!visited.has(candidate.id),
			)
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		const next = revisions[0];
		if (!next) return current;

		visited.add(next.id);
		current = next;
	}
}

function formatDuration(totalSeconds) {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	if (seconds < 60) return `${seconds} sn`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} dk`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	return remainingMinutes ? `${hours} sa ${remainingMinutes} dk` : `${hours} sa`;
}

function withTelegramActions(body, actions = '') {
	const suffix = actions ? `\n\n${actions}` : '';
	const room = Math.max(0, 4096 - suffix.length);

	return `${String(body).slice(0, room)}${suffix}`.slice(0, 4096);
}

export function formatJobStatus(job, { queuePosition = null, now = new Date(), requestedJobId = null } = {}) {
	const start = new Date(job.startedAt || job.createdAt).getTime();
	const end = job.completedAt ? new Date(job.completedAt).getTime() : now.getTime();
	const elapsed = Number.isFinite(start) && Number.isFinite(end) ? formatDuration((end - start) / 1000) : 'Bilinmiyor';
	let status = STATUS_LABELS[job.status] || job.status;

	if (job.status === 'queued' && Number.isInteger(queuePosition) && queuePosition > 0) {
		status += queuePosition === 1 ? ' (sıradaki iş)' : ` (kuyrukta ${queuePosition}. sırada)`;
	}

	const lines = [
		'İş durumu',
		'',
		...(requestedJobId ? [`Sorgulanan iş: ${requestedJobId}`, `Güncel revizyon: ${job.id}`] : [`İş no: ${job.id}`]),
		`Tür: ${JOB_TYPE_LABELS[job.type] || job.type}`,
		`Durum: ${status}`,
	];

	if (job.progress?.message && !['completed', 'failed', 'cancelled'].includes(job.status)) {
		lines.push(`Aşama: ${job.progress.message}`);
	}
	lines.push(`Geçen süre: ${elapsed}`);

	if (job.attempts > 1) lines.push(`Deneme: ${job.attempts}`);

	if (job.status === 'completed') {
		if (job.result?.kind === 'ideas' && Array.isArray(job.result.options)) {
			if (job.result.theme) lines.push('', `Tema: ${String(job.result.theme).slice(0, 300)}`);
			if (job.result.researchSummary) {
				lines.push('', String(job.result.researchSummary).slice(0, 800));
			}
			for (const [index, option] of job.result.options.entries()) {
				lines.push(
					'',
					`${index + 1}. ${String(option?.title || 'Başlıksız fikir').slice(0, 300)}`,
					String(option?.hook || '').slice(0, 600),
				);
			}

			return withTelegramActions(
				lines.join('\n'),
				`Bir fikri yazıya dönüştürmek için:\n/sec ${job.id} <seçenek-no>`,
			);
		}
		if (job.result?.title) lines.push('', `Sonuç: ${job.result.title}`);
		if (job.result?.publishedUrl) lines.push(`Yayın: ${job.result.publishedUrl}`);
		else if (job.result?.url) lines.push(`Bağlantı: ${job.result.url}`);
		else if (job.result?.previewUrl) lines.push(`Önizleme: ${job.result.previewUrl}`);
	} else if (job.status === 'failed') {
		lines.push('', `Hata: ${String(job.error || 'Bilinmeyen hata').slice(0, 1000)}`);
	} else if (job.status === 'cancelled') {
		lines.push('', 'Bu iş güvenli biçimde iptal edildi.', `Tekrar: /tekrar ${job.id}`);
	}

	return withTelegramActions(lines.join('\n'));
}

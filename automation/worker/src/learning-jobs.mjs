const LEARNING_PROMPT = 'Yayımlanan revizyon zincirinden onaya sunulabilecek editoryal bir kural olup olmadığını değerlendir.';

export function publicationLearningState(learningJob) {
	if (!learningJob) return null;
	if (learningJob.status === 'completed' && learningJob.result?.kind === 'learning') {
		return {
			status: 'completed',
			jobId: learningJob.id,
			outcome: learningJob.result.outcome,
			reason: learningJob.result.reason,
			proposal: learningJob.result.proposal || null,
		};
	}
	if (['failed', 'cancelled'].includes(learningJob.status)) {
		return {
			status: 'failed',
			jobId: learningJob.id,
			error: String(learningJob.error || 'Yayın sonrası öğrenme tamamlanamadı.').slice(0, 1_000),
		};
	}

	return { status: learningJob.status === 'running' ? 'running' : 'queued', jobId: learningJob.id };
}

export async function setPublicationLearningState(store, publicationJobId, learning) {
	return store.mutate(publicationJobId, (publication) => {
		if (publication.type !== 'publish' || publication.status !== 'completed' || publication.result?.kind !== 'publish') {
			return null;
		}

		return { result: { ...publication.result, learning } };
	});
}

export async function ensurePublicationLearningJob(store, publicationJob) {
	if (
		!publicationJob ||
		publicationJob.type !== 'publish' ||
		publicationJob.status !== 'completed' ||
		publicationJob.result?.kind !== 'publish' ||
		!publicationJob.result?.postId ||
		!publicationJob.result?.targetJobId
	) {
		throw new Error('Öğrenme işi için tamamlanmış bir yayın kaydı gerekli.');
	}
	const created = await store.create({
		type: 'learning',
		internal: true,
		prompt: LEARNING_PROMPT,
		targetJobId: publicationJob.id,
		sourceJobId: publicationJob.result.targetJobId,
		postId: publicationJob.result.postId,
		telegramChatId: publicationJob.telegramChatId,
		telegramUserId: publicationJob.telegramUserId,
		idempotencyKey: `learning:${publicationJob.id}`,
	});
	await setPublicationLearningState(store, publicationJob.id, publicationLearningState(created.job));

	return created;
}

export async function reconcilePublicationLearningJobs(store) {
	const jobs = await store.list();
	const byId = new Map(jobs.map((job) => [job.id, job]));
	let reconciled = 0;
	for (const publication of jobs) {
		if (
			publication.type !== 'publish' ||
			publication.status !== 'completed' ||
			publication.result?.kind !== 'publish' ||
			!publication.result?.learning
		) {
			continue;
		}
		let learningJob = publication.result.learning.jobId ? byId.get(publication.result.learning.jobId) : null;
		if (!learningJob && ['queued', 'running'].includes(publication.result.learning.status)) {
			const ensured = await ensurePublicationLearningJob(store, publication);
			learningJob = ensured.job;
			byId.set(learningJob.id, learningJob);
			reconciled += 1;
			continue;
		}
		if (!learningJob) continue;
		const current = publicationLearningState(learningJob);
		if (JSON.stringify(current) !== JSON.stringify(publication.result.learning)) {
			await setPublicationLearningState(store, publication.id, current);
			reconciled += 1;
		}
	}

	return reconciled;
}

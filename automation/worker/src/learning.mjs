function requiredText(value, name, maxLength) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new Error(`${name} is required.`);
	if (Array.from(text).length > maxLength) throw new Error(`${name} cannot exceed ${maxLength} characters.`);

	return text;
}

export function validateLearningResult(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Learning result must be an object.');
	if (!['none', 'proposal'].includes(value.outcome)) throw new Error('Learning outcome must be none or proposal.');
	const reason = requiredText(value.reason, 'Learning reason', 1_000);
	if (value.outcome === 'none') {
		if (value.proposal !== null) throw new Error('A none learning result cannot contain a proposal.');

		return { outcome: 'none', reason, proposal: null };
	}
	if (!value.proposal || typeof value.proposal !== 'object' || Array.isArray(value.proposal)) {
		throw new Error('A proposal learning result must contain a proposal object.');
	}
	const evidence = Array.isArray(value.proposal.evidence)
		? value.proposal.evidence.map((item) => requiredText(item, 'Learning evidence', 500)).slice(0, 8)
		: null;
	if (!evidence) throw new Error('Learning proposal evidence must be an array.');

	return {
		outcome: 'proposal',
		reason,
		proposal: {
			text: requiredText(value.proposal.text, 'Learning proposal text', 500),
			rationale: requiredText(value.proposal.rationale, 'Learning proposal rationale', 1_000),
			evidence,
		},
	};
}

export function buildPublicationLearningContext({ jobs, publicationJob, sourceJob, finalArticle, memorySnapshot }) {
	const postId = sourceJob.result?.postId;
	const relevant = jobs
		.filter(
			(job) =>
				(job.id === sourceJob.id ||
					job.id === publicationJob.id ||
					job.targetJobId === sourceJob.id ||
					(Boolean(postId) && job.result?.postId === postId)) &&
				job.telegramChatId === publicationJob.telegramChatId &&
				job.telegramUserId === publicationJob.telegramUserId,
		)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

	return {
		publication: {
			jobId: publicationJob.id,
			sourceJobId: sourceJob.id,
			postId,
			publishedAt: publicationJob.result?.publishedAt || null,
		},
		revisionChain: relevant.map((job) => ({
			jobId: job.id,
			type: job.type,
			status: job.status,
			...(job.type === 'edit' ? { explicitEditInstruction: job.prompt } : {}),
			quality: job.result?.quality || null,
		})),
		finalArticle,
		currentMemory: memorySnapshot,
	};
}

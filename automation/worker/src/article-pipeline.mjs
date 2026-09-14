export async function runArticleQualityGate({
	enabled,
	initialGeneration,
	job,
	editorialContext,
	runReview,
	runRevision,
	onProgress = async () => {},
}) {
	if (!enabled) {
		return { generated: initialGeneration, review: null, revisionCount: 0 };
	}

	await onProgress('quality-review', 'Bağımsız editör yazıyı kalite ölçütleriyle denetliyor.');
	let reviewed = await runReview(job, initialGeneration.result, editorialContext, 1);

	if (reviewed.result.verdict === 'reject') {
		throw new Error(`Yazı bağımsız kalite denetiminde reddedildi: ${reviewed.result.summary}`);
	}
	if (reviewed.result.verdict === 'pass') {
		return { generated: initialGeneration, review: reviewed, revisionCount: 0 };
	}

	await onProgress('quality-revision', 'Kalite denetimindeki somut sorunlar otomatik olarak düzeltiliyor.');
	const revised = await runRevision(job, initialGeneration.result, reviewed.result, editorialContext);
	await onProgress('quality-recheck', 'Düzeltilen yazı bağımsız editör tarafından yeniden denetleniyor.');
	reviewed = await runReview(job, revised.result, editorialContext, 2);

	if (reviewed.result.verdict !== 'pass') {
		throw new Error(`Yazı otomatik düzeltmeden sonra kalite eşiğini geçemedi: ${reviewed.result.summary}`);
	}

	return { generated: revised, review: reviewed, revisionCount: 1 };
}


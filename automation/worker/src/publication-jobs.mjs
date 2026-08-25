export async function recordSourcePublication(store, sourceJob, publication, { logger = console } = {}) {
	try {
		const updated = await store.update(sourceJob.id, {
			result: {
				...sourceJob.result,
				publishedAt: publication.publishedAt,
				publishedUrl: publication.publishedUrl,
			},
		});
		if (!updated) throw new Error('Source job no longer exists.');

		return true;
	} catch (error) {
		logger.error(
			'Published source job bookkeeping failed; publication remains completed:',
			error instanceof Error ? error.message : String(error),
		);

		return false;
	}
}

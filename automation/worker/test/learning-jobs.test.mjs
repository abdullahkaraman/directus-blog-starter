import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JobStore } from '../src/job-store.mjs';
import {
	ensurePublicationLearningJob,
	publicationLearningState,
	reconcilePublicationLearningJobs,
	setPublicationLearningState,
} from '../src/learning-jobs.mjs';

async function fixture(context) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'learning-jobs-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(path.join(root, 'jobs'));
	await store.init();
	const { job } = await store.create({
		type: 'publish',
		prompt: '/yayinla source-job',
		telegramChatId: '1',
		telegramUserId: '1',
		idempotencyKey: 'telegram:publication:1',
	});
	const publication = await store.update(job.id, {
		status: 'completed',
		result: {
			kind: 'publish',
			targetJobId: 'source-job',
			postId: 'post-1',
			title: 'Yayın',
			url: 'https://example.com/blog/yayin',
			learning: { status: 'queued', jobId: null },
		},
	});

	return { store, publication };
}

test('learning jobs are internal, publication-scoped and idempotent', async (context) => {
	const { store, publication } = await fixture(context);
	const first = await ensurePublicationLearningJob(store, publication);
	const second = await ensurePublicationLearningJob(store, await store.get(publication.id));

	assert.equal(first.created, true);
	assert.equal(second.created, false);
	assert.equal(second.job.id, first.job.id);
	assert.equal(first.job.internal, true);
	assert.equal(first.job.idempotencyKey, `learning:${publication.id}`);
	assert.deepEqual((await store.get(publication.id)).result.learning, { status: 'queued', jobId: first.job.id });
});

test('failed learning is reflected on the publication without changing publication success', async (context) => {
	const { store, publication } = await fixture(context);
	const { job } = await ensurePublicationLearningJob(store, publication);
	await store.update(job.id, { status: 'failed', error: 'review timed out' });
	await setPublicationLearningState(store, publication.id, publicationLearningState(await store.get(job.id)));

	const updated = await store.get(publication.id);
	assert.equal(updated.status, 'completed');
	assert.equal(updated.result.kind, 'publish');
	assert.deepEqual(updated.result.learning, { status: 'failed', jobId: job.id, error: 'review timed out' });
});

test('startup reconciliation repairs a publication whose queued learning job was not linked before a crash', async (context) => {
	const { store, publication } = await fixture(context);
	assert.equal(await reconcilePublicationLearningJobs(store), 1);
	const updated = await store.get(publication.id);
	assert.match(updated.result.learning.jobId, /^[a-f0-9-]{36}$/);
	assert.equal((await store.get(updated.result.learning.jobId)).type, 'learning');
});

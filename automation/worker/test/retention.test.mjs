import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JobStore } from '../src/job-store.mjs';
import { cleanupRetention } from '../src/retention.mjs';

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

test('retention removes old disposable data while protecting live, unpublished, referenced and pending jobs', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'retention-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(path.join(root, 'jobs'));
	const workspacesDir = path.join(root, 'workspaces');
	const old = '2025-01-01T00:00:00.000Z';
	const create = async (key, changes = {}) => {
		const { job } = await store.create({
			idempotencyKey: `telegram:retention:${key}`,
			telegramChatId: '1',
			telegramUserId: '2',
			prompt: 'Saklama testi için yeterince uzun bir talep.',
			...changes,
		});
		await store.update(job.id, { completedAt: old, updatedAt: old, ...changes });
		await mkdir(path.join(workspacesDir, job.id), { recursive: true });
		return store.get(job.id);
	};
	const failed = await create('failed', { status: 'failed' });
	const ideas = await create('ideas', { status: 'completed', type: 'ideas' });
	const unpublished = await create('unpublished', {
		status: 'completed',
		result: { kind: 'article', postId: 'draft-post' },
	});
	const pending = await create('pending', { status: 'failed' });
	const referenced = await create('referenced', { status: 'failed' });
	await create('referrer', { status: 'completed', type: 'edit', targetJobId: referenced.id });
	const live = await create('live', { status: 'queued' });

	const result = await cleanupRetention({
		store,
		workspacesDir,
		pendingSourceJobIds: [pending.id],
		now: new Date('2026-07-21T00:00:00.000Z'),
	});

	assert.deepEqual(new Set(result.removedJobs), new Set([failed.id, ideas.id]));
	assert.equal(await store.get(unpublished.id).then(Boolean), true);
	assert.equal(await store.get(pending.id).then(Boolean), true);
	assert.equal(await store.get(referenced.id).then(Boolean), true);
	assert.equal(await store.get(live.id).then(Boolean), true);
	assert.equal(await exists(path.join(workspacesDir, failed.id)), false);
	assert.equal(await exists(path.join(workspacesDir, pending.id)), true);
});

test('retention treats every revision link and shared post id as one component', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'retention-component-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(path.join(root, 'jobs'));
	const workspacesDir = path.join(root, 'workspaces');
	const old = '2025-01-01T00:00:00.000Z';
	let sequence = 0;
	const create = async (changes = {}) => {
		sequence += 1;
		const { job } = await store.create({
			idempotencyKey: `telegram:retention-component:${sequence}`,
			telegramChatId: '1',
			telegramUserId: '2',
			prompt: 'Bileşen saklama testi için yeterince uzun bir talep.',
			...changes,
		});
		await store.update(job.id, { completedAt: old, ...changes });
		await mkdir(path.join(workspacesDir, job.id), { recursive: true });

		return store.get(job.id);
	};

	const unpublished = await create({
		status: 'completed',
		type: 'article',
		result: { kind: 'article', postId: 'unpublished-post' },
	});
	const unpublishedFailedTail = await create({ status: 'failed', type: 'edit', targetJobId: unpublished.id });

	const published = await create({
		status: 'completed',
		type: 'article',
		result: { kind: 'article', postId: 'published-post', publishedAt: old },
	});
	const targetLinked = await create({ status: 'failed', type: 'edit', targetJobId: published.id });
	const retryLinked = await create({ status: 'failed', retriedFromJobId: targetLinked.id });
	const ideaLinked = await create({ status: 'failed', selectedFromIdeaJobId: retryLinked.id });
	const sourceLinked = await create({ status: 'failed', sourceJobId: ideaLinked.id });
	const revisedLinked = await create({
		status: 'failed',
		result: { revisedFromJobId: sourceLinked.id },
	});
	const resultTargetLinked = await create({
		status: 'failed',
		result: { targetJobId: revisedLinked.id },
	});
	const samePostLinked = await create({
		status: 'completed',
		type: 'article',
		postId: 'published-post',
		result: { kind: 'article' },
	});
	const standaloneFailed = await create({ status: 'failed' });
	const publishedComponent = [
		published,
		targetLinked,
		retryLinked,
		ideaLinked,
		sourceLinked,
		revisedLinked,
		resultTargetLinked,
		samePostLinked,
	];

	const beforePublishedExpiry = await cleanupRetention({
		store,
		workspacesDir,
		now: new Date('2025-07-21T00:00:00.000Z'),
	});
	assert.deepEqual(beforePublishedExpiry.removedJobs, [standaloneFailed.id]);
	assert.equal(Boolean(await store.get(unpublished.id)), true);
	assert.equal(Boolean(await store.get(unpublishedFailedTail.id)), true);
	for (const job of publishedComponent) assert.equal(Boolean(await store.get(job.id)), true);

	const afterPublishedExpiry = await cleanupRetention({
		store,
		workspacesDir,
		now: new Date('2026-02-01T00:00:00.000Z'),
	});
	assert.deepEqual(new Set(afterPublishedExpiry.removedJobs), new Set(publishedComponent.map((job) => job.id)));
	assert.equal(Boolean(await store.get(unpublished.id)), true);
	assert.equal(Boolean(await store.get(unpublishedFailedTail.id)), true);
});

test('retention removes only old UUID-shaped orphan workspaces', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'retention-orphan-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(path.join(root, 'jobs'));
	const workspacesDir = path.join(root, 'workspaces');
	const oldOrphan = '11111111-1111-4111-a111-111111111111';
	const recentOrphan = '22222222-2222-4222-b222-222222222222';
	const unrelatedDirectory = 'manual-notes';
	for (const name of [oldOrphan, recentOrphan, unrelatedDirectory]) {
		await mkdir(path.join(workspacesDir, name), { recursive: true });
	}
	await utimes(path.join(workspacesDir, oldOrphan), new Date('2026-06-01'), new Date('2026-06-01'));
	await utimes(path.join(workspacesDir, recentOrphan), new Date('2026-07-15'), new Date('2026-07-15'));
	await utimes(path.join(workspacesDir, unrelatedDirectory), new Date('2026-06-01'), new Date('2026-06-01'));

	const result = await cleanupRetention({
		store,
		workspacesDir,
		now: new Date('2026-07-21T00:00:00.000Z'),
	});

	assert.deepEqual(result.removedWorkspaces, [oldOrphan]);
	assert.equal(await exists(path.join(workspacesDir, oldOrphan)), false);
	assert.equal(await exists(path.join(workspacesDir, recentOrphan)), true);
	assert.equal(await exists(path.join(workspacesDir, unrelatedDirectory)), true);
});

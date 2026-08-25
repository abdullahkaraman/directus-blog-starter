import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JobStore } from '../src/job-store.mjs';

test('JobStore persists jobs and deduplicates idempotency keys', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-worker-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(root);
	const input = {
		idempotencyKey: 'telegram:1:100',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'Uygulamalı bir yazı hazırla.',
	};
	const first = await store.create(input);
	const second = await store.create(input);

	assert.equal(first.created, true);
	assert.equal(second.created, false);
	assert.equal(second.job.id, first.job.id);
	assert.equal((await store.get(first.job.id)).status, 'queued');
});

test('JobStore permits only one active or completed publication per source job', async (context) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'worker-publish-dedupe-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const store = new JobStore(directory);
	await store.init();
	const first = await store.create({
		type: 'publish',
		targetJobId: 'source-job',
		idempotencyKey: 'tg:1:publish-1',
		telegramChatId: '1',
		telegramUserId: '2',
	});
	const duplicate = await store.create({
		type: 'publish',
		targetJobId: 'source-job',
		idempotencyKey: 'tg:1:publish-2',
		telegramChatId: '1',
		telegramUserId: '2',
	});

	assert.equal(first.created, true);
	assert.equal(duplicate.created, false);
	assert.equal(duplicate.job.id, first.job.id);
	assert.equal((await store.list()).filter((job) => job.type === 'publish').length, 1);

	await store.update(first.job.id, { status: 'failed', failureStage: 'validating-source' });
	const retry = await store.create({
		type: 'publish',
		targetJobId: 'source-job',
		idempotencyKey: 'tg:1:publish-3',
		telegramChatId: '1',
		telegramUserId: '2',
	});
	assert.equal(retry.created, true);
});

test('JobStore recovers interrupted jobs', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-worker-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(root);
	const { job } = await store.create({
		idempotencyKey: 'telegram:1:101',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'Uygulamalı bir yazı hazırla.',
	});
	await store.update(job.id, { status: 'running', attempts: 0 });
	await store.recoverInterrupted(1);

	const recovered = await store.get(job.id);
	assert.equal(recovered.status, 'queued');
	assert.equal(recovered.progress.stage, 'queued');
	assert.match(recovered.progress.message, /tekrar kuyruğa alındı/);
});

test('JobStore reports queued positions and initializes progress', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-worker-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(root);
	const first = await store.create({
		idempotencyKey: 'telegram:1:201',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'Birinci uygulamalı yazıyı hazırla.',
	});
	const second = await store.create({
		idempotencyKey: 'telegram:1:202',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'İkinci uygulamalı yazıyı hazırla.',
	});

	assert.equal(first.job.progress.stage, 'queued');
	assert.equal(await store.queuePosition(first.job.id), 1);
	assert.equal(await store.queuePosition(second.job.id), 2);
	assert.equal(await store.queuePosition('missing'), null);
});

test('JobStore mutates atomically and initializes lifecycle metadata', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-worker-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(root);
	const { job } = await store.create({
		idempotencyKey: 'telegram:1:301',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'Atomik güncelleme için uygulamalı bir yazı.',
	});

	await Promise.all([
		store.mutate(job.id, (current) => ({ metrics: { executions: [...current.metrics.executions, { id: 'one' }] } })),
		store.mutate(job.id, (current) => ({ metrics: { executions: [...current.metrics.executions, { id: 'two' }] } })),
	]);
	const updated = await store.get(job.id);
	assert.deepEqual(
		updated.metrics.executions.map((execution) => execution.id),
		['one', 'two'],
	);
	assert.equal(updated.cancelRequestedAt, null);
	assert.equal(updated.failureStage, null);
	assert.equal(updated.notification.status, 'none');
});

test('JobStore finalizes cancelling jobs and blocks recovery from external writes', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-worker-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(root);
	const cancelling = await store.create({
		idempotencyKey: 'telegram:1:401',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'İptal edilen uygulamalı yazı.',
	});
	const writing = await store.create({
		idempotencyKey: 'telegram:1:402',
		telegramChatId: '1',
		telegramUserId: '2',
		prompt: 'Kaydedilen uygulamalı yazı.',
	});
	await store.update(cancelling.job.id, {
		status: 'cancelling',
		metrics: { executions: [{ id: 'running', status: 'running', startedAt: '2026-07-20T00:00:00.000Z' }] },
	});
	await store.update(writing.job.id, {
		status: 'running',
		attempts: 0,
		progress: { stage: 'saving-draft', message: 'Kaydediliyor.', updatedAt: new Date().toISOString() },
	});

	await store.recoverInterrupted(2);
	const cancelled = await store.get(cancelling.job.id);
	assert.equal(cancelled.status, 'cancelled');
	assert.equal(cancelled.metrics.executions[0].status, 'interrupted');
	assert.equal(cancelled.notification.status, 'pending');
	const failed = await store.get(writing.job.id);
	assert.equal(failed.status, 'failed');
	assert.equal(failed.failureStage, 'saving-draft');
	assert.match(failed.error, /automatic retry was blocked/);
	assert.equal(failed.notification.status, 'pending');
});

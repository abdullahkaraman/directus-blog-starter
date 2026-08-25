import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CallbackOutbox, createPendingNotification } from '../src/callback-outbox.mjs';
import { JobStore } from '../src/job-store.mjs';

async function fixture(context) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'callback-outbox-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(path.join(root, 'jobs'));
	await store.init();
	const { job } = await store.create({
		prompt: 'Yazı hazırla.',
		telegramChatId: '1',
		telegramUserId: '1',
		idempotencyKey: 'telegram:outbox:1',
	});

	return { store, job };
}

test('callback outbox persists failures and retries due terminal notifications', async (context) => {
	const { store, job } = await fixture(context);
	const firstAttempt = new Date('2026-07-21T10:00:00.000Z');
	await store.update(job.id, {
		status: 'completed',
		completedAt: firstAttempt.toISOString(),
		result: { kind: 'article', title: 'Tamamlandı' },
		notification: createPendingNotification(firstAttempt),
	});
	const requests = [];
	let succeeds = false;
	const outbox = new CallbackOutbox({
		store,
		callbackUrl: 'http://n8n.test/webhook',
		callbackToken: 'secret',
		serializeJob: ({ id, status }) => ({ id, status }),
		fetchFn: async (url, options) => {
			requests.push({ url, options });
			return { ok: succeeds, status: succeeds ? 200 : 503 };
		},
		now: () => firstAttempt,
	});

	assert.equal(await outbox.deliver(job.id), false);
	const failed = await store.get(job.id);
	assert.equal(failed.notification.status, 'pending');
	assert.equal(failed.notification.attempts, 1);
	assert.match(failed.notification.lastError, /HTTP 503/);
	assert.equal(requests.length, 1);

	succeeds = true;
	const retryTime = new Date(failed.notification.nextAttemptAt);
	const retrying = new CallbackOutbox({
		store,
		callbackUrl: 'http://n8n.test/webhook',
		callbackToken: 'secret',
		serializeJob: ({ id, status }) => ({ id, status }),
		fetchFn: async () => ({ ok: true, status: 200 }),
		now: () => retryTime,
	});
	assert.equal(await retrying.flush(), 1);
	const sent = await store.get(job.id);
	assert.equal(sent.notification.status, 'sent');
	assert.equal(sent.notification.attempts, 2);
	assert.equal(sent.notification.sentAt, retryTime.toISOString());
	assert.equal(await retrying.flush(), 0);
});

test('callback outbox ignores legacy terminal jobs without a pending notification', async (context) => {
	const { store, job } = await fixture(context);
	await store.update(job.id, { status: 'failed', completedAt: new Date().toISOString(), error: 'legacy' });
	let calls = 0;
	const outbox = new CallbackOutbox({
		store,
		callbackUrl: 'http://n8n.test/webhook',
		callbackToken: 'secret',
		fetchFn: async () => {
			calls += 1;
			return { ok: true, status: 200 };
		},
	});

	assert.equal(await outbox.flush(), 0);
	assert.equal(calls, 0);
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EditorialMemoryStore } from '../src/editorial-memory.mjs';
import { finishExecution, startExecution } from '../src/execution-metrics.mjs';
import { resolveTelegramJobCommand } from '../src/job-commands.mjs';
import { JobStore } from '../src/job-store.mjs';

async function fixture(context) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'job-command-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const store = new JobStore(path.join(root, 'jobs'));
	const memoryStore = new EditorialMemoryStore({ stateFile: path.join(root, 'editorial.json') });
	await Promise.all([store.init(), memoryStore.init()]);
	return { store, memoryStore };
}

const owner = { telegramChatId: '1', telegramUserId: '2', idempotencyKey: 'telegram:command:1' };

test('/sec creates an immutable selected-option snapshot without copying every option', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const { job } = await store.create({
		...owner,
		idempotencyKey: 'telegram:idea:1',
		type: 'ideas',
		prompt: 'Ajanlar',
	});
	await store.update(job.id, {
		status: 'completed',
		completedAt: '2026-07-21T10:00:00.000Z',
		result: {
			kind: 'ideas',
			theme: 'Ajanlar',
			researchSummary: 'Özet',
			options: [
				{ title: 'Birinci', hook: 'Kanca', angle: 'Açı', whyNow: 'Şimdi', outline: ['A'] },
				{ title: 'İkinci', hook: 'Kanca 2', angle: 'Açı 2', whyNow: 'Şimdi', outline: ['B'] },
			],
			sources: [{ title: 'Kaynak', url: 'https://example.com' }],
			editorialMemoryVersion: 'abc',
		},
	});

	const resolution = await resolveTelegramJobCommand({
		input: { ...owner, type: 'select-idea', sourceIdeaJobId: job.id, selectedIdeaNumber: 2 },
		store,
		memoryStore,
	});
	assert.equal(resolution.kind, 'enqueue');
	assert.equal(resolution.input.type, 'article');
	assert.equal(resolution.input.ideaContext.selectedOption.title, 'İkinci');
	assert.equal(resolution.input.ideaContext.options, undefined);
	assert.equal(resolution.input.selectedFromIdeaJobId, job.id);
});

test('/tekrar only retries safe failed or cancelled jobs', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const { job } = await store.create({ ...owner, idempotencyKey: 'telegram:failed:1', prompt: 'Yazı talebi.' });
	await store.update(job.id, { status: 'failed', failureStage: 'generating' });
	const retry = await resolveTelegramJobCommand({
		input: { ...owner, type: 'retry', targetJobId: job.id },
		store,
		memoryStore,
	});
	assert.equal(retry.kind, 'enqueue');
	assert.equal(retry.input.retriedFromJobId, job.id);

	await store.update(job.id, { failureStage: 'saving-draft' });
	const blocked = await resolveTelegramJobCommand({
		input: { ...owner, type: 'retry', targetJobId: job.id },
		store,
		memoryStore,
	});
	assert.equal(blocked.kind, 'immediate');
	assert.match(blocked.body.message, /otomatik tekrar güvenli değil/);
});

test('/iptal cancels queued jobs immediately and cooperatively aborts running jobs', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const queued = await store.create({ ...owner, idempotencyKey: 'telegram:cancel:1', prompt: 'Kuyruk işi.' });
	const first = await resolveTelegramJobCommand({
		input: { ...owner, type: 'cancel', targetJobId: queued.job.id },
		store,
		memoryStore,
		now: new Date('2026-07-21T10:00:00.000Z'),
	});
	assert.equal(first.kind, 'immediate');
	const cancelled = await store.get(queued.job.id);
	assert.equal(cancelled.status, 'cancelled');
	assert.equal(cancelled.notification.status, 'sent');
	assert.equal(cancelled.notification.channel, 'immediate');

	const running = await store.create({ ...owner, idempotencyKey: 'telegram:cancel:2', prompt: 'Çalışan iş.' });
	await store.update(running.job.id, { status: 'running' });
	let aborted = null;
	await resolveTelegramJobCommand({
		input: { ...owner, type: 'cancel', targetJobId: running.job.id },
		store,
		memoryStore,
		abortJob: (id) => {
			aborted = id;
		},
	});
	assert.equal(aborted, running.job.id);
	assert.equal((await store.get(running.job.id)).status, 'cancelling');
});

test('/sonisler hides internal learning jobs and /tekrar refuses them', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const visible = await store.create({ ...owner, idempotencyKey: 'telegram:visible:1', prompt: 'Görünen iş.' });
	const internal = await store.create({
		...owner,
		idempotencyKey: 'learning:publication-1',
		type: 'learning',
		internal: true,
		prompt: 'İç öğrenme.',
	});
	await store.update(internal.job.id, { status: 'failed', failureStage: 'learning' });

	const recent = await resolveTelegramJobCommand({ input: { ...owner, type: 'recent' }, store, memoryStore });
	assert.match(recent.body.message, new RegExp(visible.job.id));
	assert.doesNotMatch(recent.body.message, new RegExp(internal.job.id));
	const retry = await resolveTelegramJobCommand({
		input: { ...owner, type: 'retry', targetJobId: internal.job.id },
		store,
		memoryStore,
	});
	assert.match(retry.body.message, /İç sistem işleri/);
});

test('/yayinla prevents distinct duplicate publication jobs without breaking update idempotency', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const source = await store.create({
		...owner,
		idempotencyKey: 'telegram:article:publish-once',
		type: 'article',
		prompt: 'Yazı.',
	});
	await store.update(source.job.id, {
		status: 'completed',
		result: { kind: 'article', postId: 'post-1', slug: 'yazi', title: 'Yazı' },
	});
	const firstInput = {
		...owner,
		idempotencyKey: 'telegram:publish:first-update',
		type: 'publish',
		targetJobId: source.job.id,
	};
	const first = await resolveTelegramJobCommand({ input: firstInput, store, memoryStore });
	assert.equal(first.kind, 'enqueue');
	const publication = await store.create(first.input);

	const sameUpdate = await resolveTelegramJobCommand({ input: firstInput, store, memoryStore });
	assert.equal(sameUpdate.kind, 'enqueue');
	assert.equal((await store.create(sameUpdate.input)).job.id, publication.job.id);

	const distinctUpdate = await resolveTelegramJobCommand({
		input: { ...firstInput, idempotencyKey: 'telegram:publish:distinct-update' },
		store,
		memoryStore,
	});
	assert.equal(distinctUpdate.kind, 'immediate');
	assert.match(distinctUpdate.body.message, /yayın işlemi zaten sırada/);
	assert.match(distinctUpdate.body.message, new RegExp(publication.job.id));

	await store.update(publication.job.id, {
		status: 'completed',
		result: { kind: 'publish', url: 'https://blog.example.com/blog/yazi' },
	});
	await store.update(source.job.id, {
		result: {
			kind: 'article',
			postId: 'post-1',
			slug: 'yazi',
			title: 'Yazı',
			publishedAt: '2026-07-21T12:00:00.000Z',
			publishedUrl: 'https://blog.example.com/blog/yazi',
		},
	});
	const afterPublish = await resolveTelegramJobCommand({
		input: { ...firstInput, idempotencyKey: 'telegram:publish:after-publish' },
		store,
		memoryStore,
	});
	assert.equal(afterPublish.kind, 'immediate');
	assert.match(afterPublish.body.message, /zaten yayında/);
	assert.match(afterPublish.body.message, /https:\/\/blog\.example\.com\/blog\/yazi/);
});

test('/metrik includes the linked internal learning execution after verifying publication ownership', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const publication = await store.create({
		...owner,
		idempotencyKey: 'telegram:publish:metrics',
		type: 'publish',
		targetJobId: 'article-1',
		prompt: 'Yayınla.',
	});
	const learning = await store.create({
		...owner,
		idempotencyKey: `learning:${publication.job.id}`,
		type: 'learning',
		internal: true,
		targetJobId: publication.job.id,
		prompt: 'Yayın sonrası öğren.',
	});
	const running = startExecution(
		{ role: 'learning', configuredModel: 'learning-model', reasoningEffort: 'high' },
		{ id: 'learning-execution', now: '2026-07-21T10:00:00.000Z' },
	);
	const completed = finishExecution(running, {
		status: 'completed',
		usage: { inputTokens: 120, outputTokens: 30 },
		now: '2026-07-21T10:00:02.000Z',
	});
	await store.update(learning.job.id, {
		status: 'completed',
		completedAt: '2026-07-21T10:00:02.000Z',
		metrics: { executions: [completed] },
	});
	await store.update(publication.job.id, {
		status: 'completed',
		completedAt: '2026-07-21T10:00:03.000Z',
		result: {
			kind: 'publish',
			learning: { status: 'completed', jobId: learning.job.id },
		},
	});

	const metrics = await resolveTelegramJobCommand({
		input: { ...owner, type: 'metrics', targetJobId: publication.job.id },
		store,
		memoryStore,
	});
	assert.match(metrics.body.message, /Öğrenme — completed/);
	assert.match(metrics.body.message, /Model: learning-model/);
	assert.match(metrics.body.message, /120 girdi \/ 30 çıktı/);

	const unauthorized = await resolveTelegramJobCommand({
		input: { ...owner, telegramUserId: 'unauthorized', type: 'metrics', targetJobId: publication.job.id },
		store,
		memoryStore,
	});
	assert.match(unauthorized.body.message, /sana ait değil/);
	assert.doesNotMatch(unauthorized.body.message, /learning-model/);
});

test('memory commands require explicit approval before changing active rules', async (context) => {
	const { store, memoryStore } = await fixture(context);
	const created = await memoryStore.createProposal({ publicationJobId: 'publication-1', text: 'Örnekleri doldur.' });
	const before = await memoryStore.getSnapshot();
	const listed = await resolveTelegramJobCommand({ input: { ...owner, type: 'memory' }, store, memoryStore });
	assert.match(listed.body.message, new RegExp(created.proposal.id));
	assert.equal((await memoryStore.getSnapshot()).hash, before.hash);

	await resolveTelegramJobCommand({
		input: { ...owner, type: 'memory-approve', proposalId: created.proposal.id },
		store,
		memoryStore,
	});
	assert.notEqual((await memoryStore.getSnapshot()).hash, before.hash);
});

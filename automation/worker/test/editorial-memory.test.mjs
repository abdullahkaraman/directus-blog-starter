import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	EDITORIAL_MEMORY_MAX_ACTIVE_RULES,
	EditorialMemoryConflictError,
	EditorialMemoryCorruptionError,
	EditorialMemoryStore,
} from '../src/editorial-memory.mjs';

async function fixture(context, options = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'editorial-memory-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const stateFile = path.join(root, 'editorial', 'state.json');
	const store = new EditorialMemoryStore({ stateFile, ...options });

	return { root, stateFile, store };
}

test('initializes a schema-versioned ledger atomically with mode 0600', async (context) => {
	const { stateFile, store } = await fixture(context);
	const state = await store.init();
	const file = await stat(stateFile);
	const files = await readdir(path.dirname(stateFile));

	assert.equal(state.schemaVersion, 1);
	assert.deepEqual(state.proposals, []);
	assert.deepEqual(state.rules, []);
	assert.deepEqual(state.audit, []);
	assert.equal(file.mode & 0o777, 0o600);
	assert.deepEqual(files, ['state.json']);
	assert.deepEqual(await store.health(), {
		ok: true,
		schemaVersion: 1,
		hash: state.activeMemoryHash,
		activeRuleCount: 0,
		pendingProposalCount: 0,
	});
});

test('keeps the active memory hash stable until approval and removal', async (context) => {
	const { store } = await fixture(context);
	const initial = await store.getSnapshot();
	const first = await store.createProposal({
		publicationJobId: 'publication-1',
		text: 'Başlıklarda öğretici ve sıcak bir dil kullan.',
		sourceJobIds: ['draft-1', 'edit-1'],
	});

	assert.equal(first.created, true);
	assert.match(first.proposal.id, /^hm_[a-f0-9]{12}$/);
	assert.equal((await store.getSnapshot()).hash, initial.hash);

	const edited = await store.editProposal(
		first.proposal.id,
		'Başlıklarda sıcak, açık ve öğretici bir dil kullan.',
	);
	assert.equal(edited.status, 'pending');
	assert.equal((await store.getSnapshot()).hash, initial.hash);

	const approved = await store.approveProposal(first.proposal.id);
	assert.match(approved.rule.id, /^hr_[a-f0-9]{12}$/);
	assert.equal(approved.rule.status, 'active');
	assert.notEqual(approved.snapshot.hash, initial.hash);
	assert.match(approved.snapshot.content, /sıcak, açık ve öğretici/);

	const second = await store.createProposal({
		publicationJobId: 'publication-2',
		text: 'Örneklerde gerçek hayattan doldurulmuş veriler kullan.',
	});
	const hashAfterApproval = (await store.getSnapshot()).hash;
	await store.rejectProposal(second.proposal.id, { reason: 'Fazla genel.' });
	assert.equal((await store.getSnapshot()).hash, hashAfterApproval);

	const removed = await store.removeRule(approved.rule.id, { reason: 'Artık gerekli değil.' });
	assert.equal(removed.rule.status, 'inactive');
	assert.equal(removed.snapshot.activeRuleCount, 0);
	assert.equal(removed.snapshot.hash, initial.hash);

	const state = await store.getState();
	assert.deepEqual(
		state.audit.map((event) => event.action),
		[
			'proposal.created',
			'proposal.edited',
			'proposal.approved',
			'proposal.created',
			'proposal.rejected',
			'rule.removed',
		],
	);
});

test('allows at most one proposal per publication and rejects normalized duplicates', async (context) => {
	const { store } = await fixture(context);
	const first = await store.createProposal({
		publicationJobId: 'publication-1',
		text: 'Kısa cümleler kullan.',
	});
	const replay = await store.createProposal({
		publicationJobId: 'publication-1',
		text: 'Bu ikinci öneri kaydedilmemeli.',
	});

	assert.equal(replay.created, false);
	assert.equal(replay.proposal.id, first.proposal.id);
	await assert.rejects(
		store.createProposal({
			publicationJobId: 'publication-2',
			text: '  KISA   CÜMLELER   KULLAN.  ',
		}),
		EditorialMemoryConflictError,
	);
	await store.rejectProposal(first.proposal.id);
	await assert.rejects(
		store.createProposal({
			publicationJobId: 'publication-3',
			text: 'kısa cümleler kullan.',
		}),
		/The normalized editorial rule already exists/,
	);
});

test('allows at most one proposal for the same published Directus post', async (context) => {
	const { store } = await fixture(context);
	const first = await store.createProposal({
		publicationJobId: 'publication-1',
		postId: 'post-1',
		text: 'İlk genel kural.',
	});
	const replay = await store.createProposal({
		publicationJobId: 'publication-2',
		postId: 'post-1',
		text: 'İkinci kural kaydedilmemeli.',
	});
	assert.equal(replay.created, false);
	assert.equal(replay.proposal.id, first.proposal.id);
});

test('expires pending proposals after 30 days without changing active memory', async (context) => {
	let now = new Date('2026-07-01T00:00:00.000Z');
	const { store } = await fixture(context, { now: () => now });
	const created = await store.createProposal({
		publicationJobId: 'publication-expiring',
		text: 'Her ana bölümde bir karar kuralı ver.',
	});
	const initialHash = (await store.getSnapshot()).hash;

	now = new Date('2026-07-31T00:00:00.001Z');
	const state = await store.getState();
	const proposal = state.proposals.find((item) => item.id === created.proposal.id);

	assert.equal(proposal.status, 'expired');
	assert.equal(state.audit.at(-1).action, 'proposal.expired');
	assert.equal((await store.getSnapshot()).hash, initialHash);
	await assert.rejects(store.approveProposal(proposal.id), /Only pending proposals can be approved/);
});

test('enforces the 500-character and 50-active-rule limits', async (context) => {
	const { store } = await fixture(context);

	await assert.rejects(
		store.createProposal({ publicationJobId: 'too-long', text: 'a'.repeat(501) }),
		/cannot exceed 500 characters/,
	);

	for (let index = 0; index < EDITORIAL_MEMORY_MAX_ACTIVE_RULES; index += 1) {
		const { proposal } = await store.createProposal({
			publicationJobId: `publication-${index}`,
			text: `Editoryal kural ${index + 1}.`,
		});
		await store.approveProposal(proposal.id);
	}
	assert.equal((await store.getSnapshot()).activeRuleCount, EDITORIAL_MEMORY_MAX_ACTIVE_RULES);

	const overflow = await store.createProposal({
		publicationJobId: 'publication-overflow',
		text: 'Bu kural aktif sınıra sığmaz.',
	});
	await assert.rejects(store.approveProposal(overflow.proposal.id), /more than 50 active rules/);
});

test('enforces the 20 KB rendered dynamic-memory limit', async (context) => {
	const { store } = await fixture(context);
	let blocked = false;

	for (let index = 0; index < 30; index += 1) {
		const prefix = `Kural ${index}: `;
		const text = `${prefix}${'ğ'.repeat(500 - Array.from(prefix).length)}`;
		const { proposal } = await store.createProposal({
			publicationJobId: `large-publication-${index}`,
			text,
		});
		try {
			await store.approveProposal(proposal.id);
		} catch (error) {
			assert.match(error.message, /cannot exceed 20480 bytes/);
			blocked = true;
			break;
		}
	}

	assert.equal(blocked, true);
	assert.ok((await store.getSnapshot()).sizeBytes <= 20 * 1024);
});

test('reports corrupt ledgers and never silently resets them', async (context) => {
	const { stateFile, store } = await fixture(context);
	await store.init();
	await writeFile(stateFile, '{broken-json', 'utf8');

	const health = await store.health();
	assert.equal(health.ok, false);
	assert.equal(health.code, 'EDITORIAL_MEMORY_CORRUPT');
	await assert.rejects(store.getState(), EditorialMemoryCorruptionError);
	assert.equal(await readFile(stateFile, 'utf8'), '{broken-json');
});

test('prunes rejected and expired proposal bodies after 90 days while preserving audit and duplicate protection', async (context) => {
	let now = new Date('2026-01-01T00:00:00.000Z');
	const { store } = await fixture(context, { now: () => now });
	const created = await store.createProposal({ publicationJobId: 'publication-old', text: 'Tekrarlanabilir eski kural.' });
	await store.rejectProposal(created.proposal.id);
	now = new Date('2026-04-02T00:00:00.000Z');
	const pruned = await store.pruneProposalBodies();
	assert.deepEqual(pruned.proposalIds, [created.proposal.id]);
	const state = await store.getState();
	const proposal = state.proposals.find((candidate) => candidate.id === created.proposal.id);
	assert.equal(proposal.text, null);
	assert.equal(state.audit.at(-1).action, 'proposal.body-pruned');
	await assert.rejects(
		store.createProposal({ publicationJobId: 'publication-new', text: 'Tekrarlanabilir eski kural.' }),
		/already exists/,
	);
});

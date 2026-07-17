import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applySnapshot,
	parseCommandOptions,
	sanitizeSnapshot,
	type SchemaAdapter,
	type Snapshot,
} from '../scripts/directus-schema';

function makeSnapshot(): Snapshot {
	return {
		version: 1,
		directus: '12.1.1',
		vendor: 'postgres',
		collections: [{ collection: 'posts' }, { collection: 'globals' }, { collection: 'ai_prompts' }],
		fields: [
			{ collection: 'posts', field: 'title' },
			{ collection: 'globals', field: 'title' },
			{ collection: 'globals', field: 'openai_api_key' },
			{ collection: 'globals', field: 'directus_url' },
			{ collection: 'globals', field: 'meta_credentials' },
			{ collection: 'globals', field: 'meta_notice_security' },
			{ collection: 'ai_prompts', field: 'name' },
		],
		relations: [
			{ collection: 'posts', field: 'user_created', related_collection: 'directus_users' },
			{ collection: 'ai_prompts', field: 'user_created', related_collection: 'directus_users' },
			{ collection: 'posts', field: 'prompt', related_collection: 'ai_prompts' },
		],
		systemFields: [{ collection: 'directus_activity', field: 'timestamp' }],
	};
}

test('snapshot sanitization removes private collections and credential fields', () => {
	const input = makeSnapshot();
	const sanitized = sanitizeSnapshot(input);

	assert.deepEqual(
		sanitized.collections.map((entry) => entry.collection),
		['posts', 'globals'],
	);
	assert.deepEqual(
		sanitized.fields.map((entry) => entry.collection + '.' + entry.field),
		['posts.title', 'globals.title'],
	);
	assert.deepEqual(sanitized.relations, [
		{ collection: 'posts', field: 'user_created', related_collection: 'directus_users' },
	]);
	assert.deepEqual(sanitized.systemFields, [{ collection: 'directus_activity', field: 'timestamp' }]);
	assert.equal(input.collections.length, 3, 'sanitization must not mutate the source snapshot');
});

test('snapshot sanitization refuses empty or malformed snapshots', () => {
	assert.throws(() => sanitizeSnapshot({}), /version is missing/);
	assert.throws(
		() =>
			sanitizeSnapshot({
				version: 1,
				directus: '12.1.1',
				vendor: 'postgres',
				collections: [],
				fields: [],
				relations: [],
			}),
		/without collections/,
	);
});

test('command options reject unknown and conflicting mutations', () => {
	assert.deepEqual(parseCommandOptions([]), { apply: false, allowDestructive: false, pull: false });
	assert.deepEqual(parseCommandOptions(['--apply']), { apply: true, allowDestructive: false, pull: false });
	assert.throws(() => parseCommandOptions(['--force']), /Unknown option/);
	assert.throws(() => parseCommandOptions(['--pull', '--apply']), /cannot be used together/);
	assert.throws(() => parseCommandOptions(['--allow-destructive']), /requires --apply/);
});

test('schema setup is a dry run unless apply is explicitly requested', async () => {
	let applyCalls = 0;
	const adapter: SchemaAdapter = {
		snapshot: async () => makeSnapshot(),
		diff: async () => ({
			hash: 'test-hash',
			diff: { collections: [{ collection: 'posts' }], fields: [], relations: [] },
		}),
		apply: async () => {
			applyCalls += 1;
		},
	};

	assert.equal(await applySnapshot(makeSnapshot(), false, adapter), 'dry-run');
	assert.equal(applyCalls, 0);
	assert.equal(await applySnapshot(makeSnapshot(), true, adapter), 'applied');
	assert.equal(applyCalls, 1);
});

test('schema setup skips apply when there are no differences', async () => {
	let applyCalls = 0;
	const adapter: SchemaAdapter = {
		snapshot: async () => makeSnapshot(),
		diff: async () => null,
		apply: async () => {
			applyCalls += 1;
		},
	};

	assert.equal(await applySnapshot(makeSnapshot(), true, adapter), 'unchanged');
	assert.equal(applyCalls, 0);
});

test('schema setup refuses deletions without explicit acknowledgement', async () => {
	let applyCalls = 0;
	const adapter: SchemaAdapter = {
		snapshot: async () => makeSnapshot(),
		diff: async () => ({
			hash: 'test-hash',
			diff: { collections: [{ diff: [{ kind: 'D' }] }] },
		}),
		apply: async () => {
			applyCalls += 1;
		},
	};

	await assert.rejects(() => applySnapshot(makeSnapshot(), true, adapter), /Refusing to apply/);
	assert.equal(applyCalls, 0);
	assert.equal(await applySnapshot(makeSnapshot(), true, adapter, true), 'applied');
	assert.equal(applyCalls, 1);
});

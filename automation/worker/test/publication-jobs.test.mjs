import assert from 'node:assert/strict';
import test from 'node:test';

import { recordSourcePublication } from '../src/publication-jobs.mjs';

test('source publication bookkeeping persists the public result', async () => {
	let changes;
	const store = {
		async update(id, value) {
			assert.equal(id, 'source-1');
			changes = value;
			return { id, ...value };
		},
	};
	const recorded = await recordSourcePublication(
		store,
		{ id: 'source-1', result: { kind: 'article', postId: 'post-1' } },
		{ publishedAt: '2026-07-21T12:00:00.000Z', publishedUrl: 'https://blog.example.com/blog/yazi' },
	);

	assert.equal(recorded, true);
	assert.equal(changes.result.kind, 'article');
	assert.equal(changes.result.publishedUrl, 'https://blog.example.com/blog/yazi');
});

test('source bookkeeping failure is non-fatal after publication completed', async () => {
	const errors = [];
	const store = {
		async update() {
			throw new Error('disk unavailable');
		},
	};
	const recorded = await recordSourcePublication(
		store,
		{ id: 'source-1', result: { kind: 'article' } },
		{ publishedAt: '2026-07-21T12:00:00.000Z', publishedUrl: 'https://blog.example.com/blog/yazi' },
		{ logger: { error: (...parts) => errors.push(parts.join(' ')) } },
	);

	assert.equal(recorded, false);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /publication remains completed/);
	assert.match(errors[0], /disk unavailable/);
});

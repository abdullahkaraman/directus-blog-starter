import assert from 'node:assert/strict';
import test from 'node:test';

import { runArticleQualityGate } from '../src/article-pipeline.mjs';

const generation = { result: { title: 'İlk yazı' }, usage: { output_tokens: 100 } };

test('quality gate passes without revision when reviewer approves', async () => {
	let revisions = 0;
	const result = await runArticleQualityGate({
		enabled: true,
		initialGeneration: generation,
		job: { id: 'job-1' },
		editorialContext: {},
		runReview: async () => ({ result: { verdict: 'pass', summary: 'Hazır.', issues: [] } }),
		runRevision: async () => {
			revisions += 1;
		},
	});

	assert.equal(result.generated, generation);
	assert.equal(result.revisionCount, 0);
	assert.equal(revisions, 0);
});

test('quality gate performs exactly one revision and requires a second pass', async () => {
	const stages = [];
	let reviewCalls = 0;
	let revisionCalls = 0;
	const revised = { result: { title: 'Düzeltilmiş yazı' } };
	const result = await runArticleQualityGate({
		enabled: true,
		initialGeneration: generation,
		job: { id: 'job-2' },
		editorialContext: {},
		runReview: async () => {
			reviewCalls += 1;

			return {
				result:
					reviewCalls === 1
						? { verdict: 'revise', summary: 'Örnek eksik.', issues: [], revisionInstructions: 'Örnek ekle.' }
						: { verdict: 'pass', summary: 'Hazır.', issues: [] },
			};
		},
		runRevision: async () => {
			revisionCalls += 1;

			return revised;
		},
		onProgress: async (stage) => stages.push(stage),
	});

	assert.equal(result.generated, revised);
	assert.equal(result.revisionCount, 1);
	assert.equal(reviewCalls, 2);
	assert.equal(revisionCalls, 1);
	assert.deepEqual(stages, ['quality-review', 'quality-revision', 'quality-recheck']);
});

test('quality gate fails closed on reject or failed second review', async () => {
	await assert.rejects(
		runArticleQualityGate({
			enabled: true,
			initialGeneration: generation,
			job: {},
			editorialContext: {},
			runReview: async () => ({ result: { verdict: 'reject', summary: 'Yanlış görev.' } }),
			runRevision: async () => generation,
		}),
		/reddedildi/,
	);

	let calls = 0;
	await assert.rejects(
		runArticleQualityGate({
			enabled: true,
			initialGeneration: generation,
			job: {},
			editorialContext: {},
			runReview: async () => {
				calls += 1;

				return { result: { verdict: 'revise', summary: calls === 1 ? 'Düzelt.' : 'Hâlâ eksik.' } };
			},
			runRevision: async () => generation,
		}),
		/kalite eşiğini geçemedi/,
	);
	assert.equal(calls, 2);
});


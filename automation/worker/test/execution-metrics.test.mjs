import assert from 'node:assert/strict';
import test from 'node:test';

import {
	aggregateJobMetrics,
	finishExecution,
	formatJobMetrics,
	normalizeUsage,
	startExecution,
	upsertExecution,
} from '../src/execution-metrics.mjs';

test('execution metrics preserve account-default model truth and normalize usage', () => {
	const running = startExecution(
		{ role: 'draft', configuredModel: null, reasoningEffort: 'medium', liveSearch: false },
		{ id: 'execution-1', now: '2026-07-21T10:00:00.000Z' },
	);
	const completed = finishExecution(running, {
		status: 'completed',
		usage: { input_tokens: 100, cached_input_tokens: 25, output_tokens: 40, reasoning_output_tokens: 10 },
		now: '2026-07-21T10:00:02.500Z',
	});

	assert.equal(running.modelSource, 'account-default');
	assert.equal(running.configuredModel, null);
	assert.equal(completed.durationMs, 2500);
	assert.deepEqual(completed.usage, {
		inputTokens: 100,
		cachedInputTokens: 25,
		outputTokens: 40,
		reasoningOutputTokens: 10,
	});
	assert.match(formatJobMetrics({ id: 'job-1', metrics: { executions: [completed] } }), /gerçek model raporlanmadı/);
});

test('execution metrics upsert running records and aggregate the latest measured jobs', () => {
	const running = startExecution(
		{ role: 'review', configuredModel: 'gpt-test', reasoningEffort: 'high' },
		{ id: 'review-1', now: '2026-07-21T10:00:00.000Z' },
	);
	const completed = finishExecution(running, {
		status: 'completed',
		usage: { inputTokens: 50, outputTokens: 12 },
		review: { verdict: 'pass', issues: [] },
		now: '2026-07-21T10:00:01.000Z',
	});
	let metrics = upsertExecution(null, running);
	metrics = upsertExecution(metrics, completed);
	assert.equal(metrics.executions.length, 1);
	assert.equal(metrics.executions[0].review.verdict, 'pass');

	const summary = aggregateJobMetrics([
		{ id: 'job-1', status: 'completed', completedAt: '2026-07-21T10:00:02.000Z', metrics },
		{ id: 'legacy', status: 'completed', completedAt: '2026-07-21T10:00:03.000Z' },
	]);
	assert.equal(summary.jobCount, 1);
	assert.equal(summary.executionCount, 1);
	assert.equal(summary.roles.review.count, 1);
	assert.equal(normalizeUsage(completed.usage).outputTokens, 12);
});

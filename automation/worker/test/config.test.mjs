import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConfig } from '../src/config.mjs';

const requiredEnvironment = {
	WORKER_API_TOKEN: 'worker-token',
	TELEGRAM_ALLOWED_USER_ID: '123',
	DIRECTUS_URL: 'https://directus.example.com',
	DIRECTUS_TOKEN: 'directus-token',
	SITE_URL: 'https://blog.example.com',
	DRAFT_PREVIEW_SECRET: 'preview-token',
};

test('loadConfig uses bounded editorial execution defaults', () => {
	const config = loadConfig(requiredEnvironment);

	assert.equal(config.codexReasoningEffort, 'medium');
	assert.equal(config.codexIdeaReasoningEffort, 'xhigh');
	assert.equal(config.codexReviewReasoningEffort, 'medium');
	assert.equal(config.codexQualityReviewEnabled, false);
	assert.equal(config.codexDraftModel, null);
	assert.equal(config.codexTimeoutMs, 12 * 60 * 1000);
	assert.equal(config.codexIdeaTimeoutMs, 15 * 60 * 1000);
	assert.equal(config.codexReviewTimeoutMs, 2 * 60 * 1000);
	assert.equal(config.codexRevisionTimeoutMs, 6 * 60 * 1000);
	assert.equal(config.codexLearningModel, null);
	assert.equal(config.codexLearningReasoningEffort, 'medium');
	assert.equal(config.codexLearningTimeoutMs, 2 * 60 * 1000);
	assert.equal(config.workspaceRetentionDays, 14);
	assert.equal(config.jobRetentionDays, 90);
	assert.equal(config.publishedRetentionDays, 365);
	assert.equal(config.contentProfile.id, 'default');
	assert.equal(config.contentProfile.cms.collection, 'posts');
});

test('loadConfig accepts safe model role overrides and rejects unsafe values', () => {
	const config = loadConfig({
		...requiredEnvironment,
		CODEX_DRAFT_MODEL: 'account-supported-draft-model',
		CODEX_REVIEW_MODEL: 'account-supported-review-model',
		CODEX_QUALITY_REVIEW_ENABLED: 'true',
		CODEX_LEARNING_MODEL: 'learning-model',
	});

	assert.equal(config.codexDraftModel, 'account-supported-draft-model');
	assert.equal(config.codexReviewModel, 'account-supported-review-model');
	assert.equal(config.codexQualityReviewEnabled, true);
	assert.equal(config.codexRevisionModel, null);
	assert.equal(config.codexLearningModel, 'learning-model');
	assert.throws(
		() => loadConfig({ ...requiredEnvironment, CODEX_REVIEW_MODEL: 'model; rm -rf /' }),
		/unsupported characters/,
	);
});

test('loadConfig allows the isolated reviewer to use the account-supported default model', () => {
	const config = loadConfig({ ...requiredEnvironment, CODEX_QUALITY_REVIEW_ENABLED: 'true' });

	assert.equal(config.codexQualityReviewEnabled, true);
	assert.equal(config.codexReviewModel, null);
	assert.equal(config.codexRevisionModel, null);
});

test('loadConfig keeps every explicit model role independent', () => {
	const config = loadConfig({
		...requiredEnvironment,
		CODEX_REVIEW_MODEL: 'review-model',
		CODEX_REVISION_MODEL: 'revision-model',
	});

	assert.equal(config.codexReviewModel, 'review-model');
	assert.equal(config.codexRevisionModel, 'revision-model');
});

test('loadConfig rejects unsupported reasoning effort', () => {
	assert.throws(
		() => loadConfig({ ...requiredEnvironment, CODEX_REASONING_EFFORT: 'maximum' }),
		/CODEX_REASONING_EFFORT must be one of/,
	);
});

test('loadConfig rejects ambiguous booleans and insecure remote service URLs', () => {
	assert.throws(
		() => loadConfig({ ...requiredEnvironment, CODEX_QUALITY_REVIEW_ENABLED: 'treu' }),
		/CODEX_QUALITY_REVIEW_ENABLED must be one of/,
	);
	assert.throws(
		() => loadConfig({ ...requiredEnvironment, DIRECTUS_URL: 'http://cms.example.com' }),
		/DIRECTUS_URL must use HTTPS/,
	);
	assert.equal(loadConfig({ ...requiredEnvironment, DIRECTUS_URL: 'http://directus:8055' }).directusUrl, 'http://directus:8055');
});

test('loadConfig reads application secrets from root-prepared files', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'config-secret-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const tokenFile = path.join(root, 'directus-token');
	await writeFile(tokenFile, 'file-backed-token\n');
	const config = loadConfig({
		...requiredEnvironment,
		DIRECTUS_TOKEN: undefined,
		DIRECTUS_TOKEN_FILE: tokenFile,
	});

	assert.equal(config.directusToken, 'file-backed-token');
});

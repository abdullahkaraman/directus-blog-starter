import path from 'node:path';
import { readFileSync } from 'node:fs';

import { loadContentProfile } from './content-profile.mjs';

function configuredValue(env, name) {
	const file = env[`${name}_FILE`]?.trim();
	if (file) {
		try {
			return readFileSync(file, 'utf8').trim();
		} catch (error) {
			throw new Error(`${name}_FILE could not be read: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return env[name]?.trim();
}

function required(env, name) {
	const value = configuredValue(env, name);
	if (!value) throw new Error(`${name} is required.`);

	return value;
}

function positiveInteger(value, fallback, name) {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);

	return parsed;
}

function boolean(value, fallback = false, name = 'value') {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	throw new Error(`${name} must be one of: true, false, 1, 0, yes, no, on, off.`);
}

function enumValue(value, fallback, allowed, name) {
	const normalized = value?.trim().toLowerCase() || fallback;
	if (!allowed.includes(normalized)) throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);

	return normalized;
}

function optionalModel(value, name) {
	const model = value?.trim() || null;
	if (model && !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error(`${name} contains unsupported characters.`);

	return model;
}

function secureServiceUrl(value, name) {
	const raw = required({ [name]: value }, name).replace(/\/$/, '');
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`${name} must be a valid URL.`);
	}
	const localHttp =
		url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', 'directus'].includes(url.hostname.toLowerCase());
	if (url.protocol !== 'https:' && !localHttp) {
		throw new Error(`${name} must use HTTPS (plain HTTP is allowed only for a local Directus service).`);
	}
	if (url.username || url.password) throw new Error(`${name} must not contain URL credentials.`);

	return raw;
}

export function loadConfig(env = process.env) {
	const dataDir = path.resolve(env.WORKER_DATA_DIR?.trim() || '/data');
	const contentProfile = loadContentProfile(env.CONTENT_PROFILE_DIR?.trim());
	const codexQualityReviewEnabled = boolean(env.CODEX_QUALITY_REVIEW_ENABLED, false, 'CODEX_QUALITY_REVIEW_ENABLED');
	const codexReviewModel = optionalModel(env.CODEX_REVIEW_MODEL, 'CODEX_REVIEW_MODEL');

	const telegramAllowedUserId = required(env, 'TELEGRAM_ALLOWED_USER_ID');

	return {
		contentProfile,
		port: positiveInteger(env.PORT, 8787, 'PORT'),
		dataDir,
		jobsDir: path.join(dataDir, 'jobs'),
		workspacesDir: path.join(dataDir, 'workspaces'),
		editorialStateFile: path.join(dataDir, 'editorial', 'state.json'),
		operationsStateFile: path.join(dataDir, 'operations', 'state.json'),
		backupStatusFile: path.join(dataDir, 'operations', 'last-backup.json'),
		workerApiToken: required(env, 'WORKER_API_TOKEN'),
		telegramAllowedUserId,
		telegramAllowedChatId: env.TELEGRAM_ALLOWED_CHAT_ID?.trim() || telegramAllowedUserId,
		directusUrl: secureServiceUrl(env.DIRECTUS_URL, 'DIRECTUS_URL'),
		directusToken: required(env, 'DIRECTUS_TOKEN'),
		siteUrl: secureServiceUrl(env.SITE_URL, 'SITE_URL'),
		previewSecret: required(env, 'DRAFT_PREVIEW_SECRET'),
		n8nCallbackUrl: env.N8N_CALLBACK_URL?.trim() || null,
		n8nCallbackToken: configuredValue(env, 'N8N_CALLBACK_TOKEN') || null,
		codexBinary: env.CODEX_BINARY?.trim() || 'codex',
		codexLiveSearch: boolean(env.CODEX_LIVE_SEARCH, false, 'CODEX_LIVE_SEARCH'),
		codexQualityReviewEnabled,
		codexDraftModel: optionalModel(env.CODEX_DRAFT_MODEL, 'CODEX_DRAFT_MODEL'),
		codexIdeaModel: optionalModel(env.CODEX_IDEA_MODEL, 'CODEX_IDEA_MODEL'),
		codexReviewModel,
		codexRevisionModel: optionalModel(env.CODEX_REVISION_MODEL, 'CODEX_REVISION_MODEL'),
		codexLearningModel: optionalModel(env.CODEX_LEARNING_MODEL, 'CODEX_LEARNING_MODEL'),
		codexReasoningEffort: enumValue(
			env.CODEX_REASONING_EFFORT,
			'medium',
			['low', 'medium', 'high', 'xhigh'],
			'CODEX_REASONING_EFFORT',
		),
		codexIdeaReasoningEffort: enumValue(
			env.CODEX_IDEA_REASONING_EFFORT,
			'xhigh',
			['low', 'medium', 'high', 'xhigh'],
			'CODEX_IDEA_REASONING_EFFORT',
		),
		codexReviewReasoningEffort: enumValue(
			env.CODEX_REVIEW_REASONING_EFFORT,
			'medium',
			['low', 'medium', 'high', 'xhigh'],
			'CODEX_REVIEW_REASONING_EFFORT',
		),
		codexRevisionReasoningEffort: enumValue(
			env.CODEX_REVISION_REASONING_EFFORT,
			'medium',
			['low', 'medium', 'high', 'xhigh'],
			'CODEX_REVISION_REASONING_EFFORT',
		),
		codexLearningReasoningEffort: enumValue(
			env.CODEX_LEARNING_REASONING_EFFORT,
			'medium',
			['low', 'medium', 'high', 'xhigh'],
			'CODEX_LEARNING_REASONING_EFFORT',
		),
		codexTimeoutMs: positiveInteger(env.CODEX_TIMEOUT_MS, 12 * 60 * 1000, 'CODEX_TIMEOUT_MS'),
		codexIdeaTimeoutMs: positiveInteger(env.CODEX_IDEA_TIMEOUT_MS, 15 * 60 * 1000, 'CODEX_IDEA_TIMEOUT_MS'),
		codexReviewTimeoutMs: positiveInteger(env.CODEX_REVIEW_TIMEOUT_MS, 2 * 60 * 1000, 'CODEX_REVIEW_TIMEOUT_MS'),
		codexRevisionTimeoutMs: positiveInteger(
			env.CODEX_REVISION_TIMEOUT_MS,
			6 * 60 * 1000,
			'CODEX_REVISION_TIMEOUT_MS',
		),
		codexLearningTimeoutMs: positiveInteger(
			env.CODEX_LEARNING_TIMEOUT_MS,
			2 * 60 * 1000,
			'CODEX_LEARNING_TIMEOUT_MS',
		),
		maxAttempts: positiveInteger(env.WORKER_MAX_ATTEMPTS, 1, 'WORKER_MAX_ATTEMPTS'),
		pollIntervalMs: positiveInteger(env.WORKER_POLL_INTERVAL_MS, 1000, 'WORKER_POLL_INTERVAL_MS'),
		cleanupIntervalMs: positiveInteger(
			env.WORKER_CLEANUP_INTERVAL_MS,
			24 * 60 * 60 * 1000,
			'WORKER_CLEANUP_INTERVAL_MS',
		),
		workspaceRetentionDays: positiveInteger(
			env.WORKER_WORKSPACE_RETENTION_DAYS,
			14,
			'WORKER_WORKSPACE_RETENTION_DAYS',
		),
		jobRetentionDays: positiveInteger(env.WORKER_JOB_RETENTION_DAYS, 90, 'WORKER_JOB_RETENTION_DAYS'),
		publishedRetentionDays: positiveInteger(
			env.WORKER_PUBLISHED_RETENTION_DAYS,
			365,
			'WORKER_PUBLISHED_RETENTION_DAYS',
		),
		backupMaxAgeHours: positiveInteger(env.WORKER_BACKUP_MAX_AGE_HOURS, 36, 'WORKER_BACKUP_MAX_AGE_HOURS'),
		failureAlertThreshold: positiveInteger(
			env.WORKER_FAILURE_ALERT_THRESHOLD,
			3,
			'WORKER_FAILURE_ALERT_THRESHOLD',
		),
		learningFailureAlertThreshold: positiveInteger(
			env.WORKER_LEARNING_FAILURE_ALERT_THRESHOLD,
			2,
			'WORKER_LEARNING_FAILURE_ALERT_THRESHOLD',
		),
		alertDedupeHours: positiveInteger(env.WORKER_ALERT_DEDUPE_HOURS, 6, 'WORKER_ALERT_DEDUPE_HOURS'),
	};
}

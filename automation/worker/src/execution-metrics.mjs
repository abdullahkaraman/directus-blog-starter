import { randomUUID } from 'node:crypto';

const TERMINAL_EXECUTION_STATUSES = new Set(['completed', 'failed', 'interrupted']);
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function iso(now) {
	return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function integer(value) {
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeUsage(usage) {
	if (!usage || typeof usage !== 'object') return null;

	return {
		inputTokens: integer(usage.inputTokens ?? usage.input_tokens),
		cachedInputTokens: integer(usage.cachedInputTokens ?? usage.cached_input_tokens),
		outputTokens: integer(usage.outputTokens ?? usage.output_tokens),
		reasoningOutputTokens: integer(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens),
	};
}

export function startExecution(
	{ role, configuredModel = null, reasoningEffort, liveSearch = false },
	{ id = randomUUID(), now } = {},
) {
	if (!['idea', 'draft', 'review', 'revision', 'learning'].includes(role)) {
		throw new Error(`Unsupported execution role: ${role}`);
	}

	return {
		id,
		role,
		status: 'running',
		configuredModel: configuredModel || null,
		modelSource: configuredModel ? 'explicit' : 'account-default',
		reasoningEffort,
		liveSearch: Boolean(liveSearch),
		startedAt: iso(now),
		completedAt: null,
		durationMs: null,
		usage: null,
		review: null,
		error: null,
	};
}

export function finishExecution(execution, { status, usage = null, review = null, error = null, now } = {}) {
	if (!TERMINAL_EXECUTION_STATUSES.has(status)) throw new Error(`Unsupported terminal execution status: ${status}`);
	const completedAt = iso(now);
	const durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(execution.startedAt).getTime());

	return {
		...execution,
		status,
		completedAt,
		durationMs,
		usage: normalizeUsage(usage),
		review: review
			? {
					verdict: review.verdict,
					issueCount: Array.isArray(review.issues) ? review.issues.length : 0,
					majorIssueCount: Array.isArray(review.issues)
						? review.issues.filter((issue) => issue?.severity === 'major').length
						: 0,
					minorIssueCount: Array.isArray(review.issues)
						? review.issues.filter((issue) => issue?.severity === 'minor').length
						: 0,
				}
			: null,
		error: error ? String(error).slice(0, 1000) : null,
	};
}

export function upsertExecution(metrics, execution) {
	const executions = Array.isArray(metrics?.executions) ? [...metrics.executions] : [];
	const index = executions.findIndex((candidate) => candidate.id === execution.id);
	if (index === -1) executions.push(execution);
	else executions[index] = execution;

	return { ...(metrics || {}), executions };
}

function measuredTerminalJobs(jobs, limit) {
	return jobs
		.filter(
			(job) =>
				TERMINAL_JOB_STATUSES.has(job.status) &&
				Array.isArray(job.metrics?.executions) &&
				job.metrics.executions.some((execution) => TERMINAL_EXECUTION_STATUSES.has(execution.status)),
		)
		.sort((left, right) =>
			String(right.completedAt || right.updatedAt).localeCompare(String(left.completedAt || left.updatedAt)),
		)
		.slice(0, limit);
}

export function aggregateJobMetrics(jobs, { limit = 20 } = {}) {
	const selectedJobs = measuredTerminalJobs(jobs, limit);
	const executions = selectedJobs.flatMap((job) =>
		job.metrics.executions.flatMap((execution) =>
			TERMINAL_EXECUTION_STATUSES.has(execution.status) ? [execution] : [],
		),
	);
	const usage = executions.reduce(
		(totals, execution) => {
			const current = normalizeUsage(execution.usage);
			if (!current) return totals;
			for (const key of Object.keys(totals)) totals[key] += current[key];
			return totals;
		},
		{ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
	);
	const roles = {};
	for (const execution of executions) {
		roles[execution.role] ||= { count: 0, completed: 0, failed: 0, interrupted: 0, durationMs: 0 };
		roles[execution.role].count += 1;
		roles[execution.role][execution.status] += 1;
		roles[execution.role].durationMs += integer(execution.durationMs);
	}

	return {
		jobCount: selectedJobs.length,
		executionCount: executions.length,
		completedExecutionCount: executions.filter((execution) => execution.status === 'completed').length,
		failedExecutionCount: executions.filter((execution) => execution.status === 'failed').length,
		interruptedExecutionCount: executions.filter((execution) => execution.status === 'interrupted').length,
		durationMs: executions.reduce((total, execution) => total + integer(execution.durationMs), 0),
		usage,
		roles,
	};
}

const numberFormatter = new Intl.NumberFormat('tr-TR');

function formatNumber(value) {
	return numberFormatter.format(integer(value));
}

function formatDuration(milliseconds) {
	const seconds = Math.round(integer(milliseconds) / 1000);
	if (seconds < 60) return `${seconds} sn`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;

	return remainder ? `${minutes} dk ${remainder} sn` : `${minutes} dk`;
}

export function formatMetricsSummary(summary) {
	if (!summary.executionCount) return 'Henüz ölçülmüş tamamlanmış bir Codex yürütmesi yok.';
	const roleLabels = { idea: 'fikir', draft: 'taslak', review: 'denetim', revision: 'düzeltme', learning: 'öğrenme' };
	const roleLines = Object.entries(summary.roles).map(
		([role, value]) =>
			`• ${roleLabels[role] || role}: ${value.count} çağrı, ${formatDuration(value.durationMs)}, ${value.failed + value.interrupted} sorun`,
	);

	return [
		'Son işler için Codex metrikleri',
		'',
		`İş: ${summary.jobCount}`,
		`Codex çağrısı: ${summary.executionCount}`,
		`Toplam süre: ${formatDuration(summary.durationMs)}`,
		`Başarılı / sorunlu: ${summary.completedExecutionCount} / ${summary.failedExecutionCount + summary.interruptedExecutionCount}`,
		`Token: ${formatNumber(summary.usage.inputTokens)} girdi, ${formatNumber(summary.usage.cachedInputTokens)} önbellek, ${formatNumber(summary.usage.outputTokens)} çıktı, ${formatNumber(summary.usage.reasoningOutputTokens)} muhakeme`,
		'',
		...roleLines,
	].join('\n');
}

export function formatJobMetrics(job) {
	const executions = job?.metrics?.executions || [];
	if (!executions.length) return `İş ${job?.id || ''} için henüz Codex yürütme metriği yok.`.trim();
	const roleLabels = { idea: 'Fikir', draft: 'Taslak', review: 'Denetim', revision: 'Düzeltme', learning: 'Öğrenme' };
	const lines = executions.map((execution, index) => {
		const model = execution.configuredModel || 'ChatGPT hesabı varsayılanı (gerçek model raporlanmadı)';
		const usage = normalizeUsage(execution.usage);
		const tokenText = usage
			? `${formatNumber(usage.inputTokens)} girdi / ${formatNumber(usage.outputTokens)} çıktı`
			: 'token verisi yok';

		return `${index + 1}. ${roleLabels[execution.role] || execution.role} — ${execution.status}\nModel: ${model}\nMuhakeme: ${execution.reasoningEffort}; arama: ${execution.liveSearch ? 'açık' : 'kapalı'}\nSüre: ${formatDuration(execution.durationMs)}; ${tokenText}`;
	});

	return [`İş metrikleri`, '', `İş no: ${job.id}`, '', ...lines].join('\n');
}

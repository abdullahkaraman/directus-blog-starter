import { stripHtml } from './article.mjs';

const VERDICTS = new Set(['pass', 'revise', 'reject']);
const SEVERITIES = new Set(['blocker', 'major', 'minor']);

function clean(value, maxLength) {
	return stripHtml(String(value || '')).slice(0, maxLength);
}

export function validateQualityReview(raw) {
	if (!raw || typeof raw !== 'object') throw new Error('Quality reviewer did not return an object.');

	const verdict = VERDICTS.has(raw.verdict) ? raw.verdict : null;
	if (!verdict) throw new Error('Quality reviewer verdict is invalid.');

	const issues = Array.isArray(raw.issues)
		? raw.issues.slice(0, 20).map((issue) => ({
				severity: SEVERITIES.has(issue?.severity) ? issue.severity : 'major',
				criterion: clean(issue?.criterion, 120),
				evidence: clean(issue?.evidence, 500),
				instruction: clean(issue?.instruction, 500),
			}))
		: [];
	const blockerIssues = issues.filter((issue) => issue.severity === 'blocker');
	const majorIssues = issues.filter((issue) => issue.severity === 'major');
	const summary = clean(raw.summary, 1_000);
	const revisionInstructions = clean(raw.revisionInstructions, 4_000);

	if (verdict === 'pass' && (blockerIssues.length > 0 || majorIssues.length > 0)) {
		throw new Error('Quality reviewer pass verdict conflicts with its blocking issues.');
	}
	if (verdict === 'revise' && (blockerIssues.length > 0 || majorIssues.length === 0 || !revisionInstructions)) {
		throw new Error('Quality reviewer requested revision without instructions.');
	}
	if (verdict === 'reject' && blockerIssues.length === 0) {
		throw new Error('Quality reviewer reject verdict requires a blocker.');
	}

	return { verdict, summary, issues, revisionInstructions };
}

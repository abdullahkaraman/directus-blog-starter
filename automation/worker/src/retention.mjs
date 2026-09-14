import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_STATUSES = new Set(['queued', 'running', 'cancelling']);
const UUID_WORKSPACE_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function ageDays(job, now) {
	const timestamp = new Date(job.completedAt || job.updatedAt || job.createdAt).getTime();

	return Number.isFinite(timestamp) ? (now.getTime() - timestamp) / DAY_MS : 0;
}

function jobActivityTimestamp(job) {
	const primary = Date.parse(job.completedAt || job.updatedAt || job.createdAt);
	const published = Date.parse(job.publishedAt || job.result?.publishedAt);
	const candidates = [primary, published].filter(Number.isFinite);

	return candidates.length ? Math.max(...candidates) : null;
}

function componentAgeDays(jobs, now) {
	const timestamps = jobs.flatMap((job) => {
		const activityTimestamp = jobActivityTimestamp(job);

		return Number.isFinite(activityTimestamp) ? [activityTimestamp] : [];
	});
	if (!timestamps.length) return 0;

	return (now.getTime() - Math.max(...timestamps)) / DAY_MS;
}

function jobLinks(job) {
	return [
		job.targetJobId,
		job.retriedFromJobId,
		job.selectedFromIdeaJobId,
		job.sourceJobId,
		job.result?.revisedFromJobId,
		job.result?.targetJobId,
	].filter(Boolean);
}

function buildComponents(jobs) {
	const byId = new Map(jobs.map((job) => [job.id, job]));
	const adjacency = new Map(jobs.map((job) => [job.id, new Set()]));
	const connect = (left, right) => {
		if (!byId.has(left) || !byId.has(right) || left === right) return;
		adjacency.get(left).add(right);
		adjacency.get(right).add(left);
	};

	for (const job of jobs) {
		for (const linkedId of jobLinks(job)) connect(job.id, linkedId);
	}
	const firstByPostId = new Map();
	for (const job of jobs) {
		const postId = job.postId || job.result?.postId;
		if (!postId) continue;
		const first = firstByPostId.get(postId);
		if (first) connect(job.id, first);
		else firstByPostId.set(postId, job.id);
	}

	const visited = new Set();
	const components = [];
	for (const job of jobs) {
		if (visited.has(job.id)) continue;
		const pending = [job.id];
		const component = [];
		visited.add(job.id);
		while (pending.length) {
			const id = pending.pop();
			component.push(byId.get(id));
			for (const neighbor of adjacency.get(id)) {
				if (visited.has(neighbor)) continue;
				visited.add(neighbor);
				pending.push(neighbor);
			}
		}
		components.push(component);
	}

	return components;
}

function isPublished(job) {
	return Boolean(
		job.publishedAt ||
			job.publishedUrl ||
			job.result?.publishedAt ||
			job.result?.publishedUrl ||
			(job.status === 'completed' && (job.type === 'publish' || job.result?.kind === 'publish')),
	);
}

function isUnpublishedArtifact(job) {
	if (job.status !== 'completed' || isPublished(job)) return false;

	return (
		['article', 'edit'].includes(job.type) ||
		job.result?.kind === 'article' ||
		Boolean(job.postId || job.result?.postId)
	);
}

function isDisposable(job) {
	return ['failed', 'cancelled'].includes(job.status) || (job.type === 'ideas' && job.status === 'completed');
}

export async function cleanupRetention({
	store,
	workspacesDir,
	pendingSourceJobIds = [],
	now = new Date(),
	workspaceRetentionDays = 14,
	jobRetentionDays = 90,
	publishedRetentionDays = 365,
}) {
	const jobs = await store.list();
	const byId = new Map(jobs.map((job) => [job.id, job]));
	const pendingIds = new Set(pendingSourceJobIds);
	const workspaceProtectedIds = new Set();
	const removedJobs = [];
	const jobsToRemove = [];

	for (const component of buildComponents(jobs)) {
		const hasLiveJob = component.some((job) => LIVE_STATUSES.has(job.status));
		const hasPendingProposalSource = component.some((job) => pendingIds.has(job.id));
		const published = component.some(isPublished);
		const unpublished = !published && component.some(isUnpublishedArtifact);
		if (hasLiveJob || hasPendingProposalSource || unpublished) {
			for (const job of component) workspaceProtectedIds.add(job.id);
			continue;
		}

		const age = componentAgeDays(component, now);
		const shouldRemove = published
			? age >= publishedRetentionDays
			: component.every(isDisposable) && age >= jobRetentionDays;
		if (!shouldRemove) continue;
		for (const job of component) {
			jobsToRemove.push(job.id);
		}
	}
	const removalResults = await Promise.all(
		jobsToRemove.map(async (id) => ({
			id,
			removed: await store.remove(id),
		})),
	);
	for (const result of removalResults) {
		if (result.removed) removedJobs.push(result.id);
	}

	const removedWorkspaces = [];
	let workspaceEntries = [];
	try {
		workspaceEntries = await readdir(workspacesDir, { withFileTypes: true });
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
	for (const entry of workspaceEntries) {
		if (!entry.isDirectory()) continue;
		const id = entry.name;
		const job = byId.get(id);
		if (job) {
			if (LIVE_STATUSES.has(job.status) || workspaceProtectedIds.has(id)) continue;
			if (ageDays(job, now) < workspaceRetentionDays) continue;
		} else {
			if (!UUID_WORKSPACE_PATTERN.test(id)) continue;
			const metadata = await stat(path.join(workspacesDir, id));
			if ((now.getTime() - metadata.mtimeMs) / DAY_MS < workspaceRetentionDays) continue;
		}
		await rm(path.join(workspacesDir, id), { recursive: true, force: true });
		removedWorkspaces.push(id);
	}

	return { removedJobs, removedWorkspaces };
}

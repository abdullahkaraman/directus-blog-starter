import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createPendingNotification } from './callback-outbox.mjs';

function timestamp() {
	return new Date().toISOString();
}

function interruptRunningExecutions(job, completedAt) {
	const executions = Array.isArray(job.metrics?.executions) ? job.metrics.executions : [];
	let changed = false;
	const updated = executions.map((execution) => {
		if (execution.status !== 'running') return execution;
		changed = true;
		const startedAt = Date.parse(execution.startedAt);
		const endedAt = Date.parse(completedAt);

		return {
			...execution,
			status: 'interrupted',
			completedAt,
			durationMs: Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : null,
			error: 'Worker restarted during this Codex execution.',
		};
	});

	return changed ? { ...(job.metrics || {}), executions: updated } : job.metrics;
}

export class JobStore {
	#jobsDir;
	#lock = Promise.resolve();

	constructor(jobsDir) {
		this.#jobsDir = jobsDir;
	}

	async init() {
		await mkdir(this.#jobsDir, { recursive: true });
	}

	async #withLock(operation) {
		const previous = this.#lock;
		let release;
		this.#lock = new Promise((resolve) => {
			release = resolve;
		});
		await previous;

		try {
			return await operation();
		} finally {
			release();
		}
	}

	#file(id) {
		return path.join(this.#jobsDir, `${id}.json`);
	}

	async #write(job) {
		const target = this.#file(job.id);
		const temporary = `${target}.${randomUUID()}.tmp`;
		await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, target);

		return job;
	}

	async list() {
		await this.init();
		const files = (await readdir(this.#jobsDir)).filter((file) => file.endsWith('.json')).sort();
		const jobs = await Promise.all(
			files.map(async (file) => JSON.parse(await readFile(path.join(this.#jobsDir, file), 'utf8'))),
		);

		return jobs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	}

	async get(id) {
		try {
			return JSON.parse(await readFile(this.#file(id), 'utf8'));
		} catch (error) {
			if (error?.code === 'ENOENT') return null;
			throw error;
		}
	}

	async create(input) {
		return this.#withLock(async () => {
			const jobs = await this.list();
			const existing = jobs.find((job) => job.idempotencyKey === input.idempotencyKey);
			if (existing) return { created: false, job: existing };
			if (input.type === 'publish' && input.targetJobId) {
				const existingPublication = jobs.find(
					(job) =>
						job.type === 'publish' &&
						job.targetJobId === input.targetJobId &&
						['queued', 'running', 'cancelling', 'completed'].includes(job.status),
				);
				if (existingPublication) return { created: false, job: existingPublication };
			}

			const now = timestamp();
			const job = {
				id: randomUUID(),
				type: 'article',
				status: 'queued',
				attempts: 0,
				createdAt: now,
				updatedAt: now,
				startedAt: null,
				completedAt: null,
				threadId: null,
				result: null,
				error: null,
				failureStage: null,
				cancelRequestedAt: null,
				cancelledAt: null,
				metrics: { executions: [] },
				notification: {
					status: 'none',
					attempts: 0,
					nextAttemptAt: null,
					lastAttemptAt: null,
					sentAt: null,
					lastError: null,
				},
				progress: {
					stage: 'queued',
					message: 'İş worker kuyruğunda bekliyor.',
					updatedAt: now,
				},
				...input,
			};
			await this.#write(job);

			return { created: true, job };
		});
	}

	async update(id, changes) {
		return this.mutate(id, () => changes);
	}

	async mutate(id, updater) {
		return this.#withLock(async () => {
			const current = await this.get(id);
			if (!current) return null;
			const changes = typeof updater === 'function' ? await updater(structuredClone(current)) : updater;
			if (!changes) return current;
			const updated = { ...current, ...changes, id: current.id, updatedAt: timestamp() };
			await this.#write(updated);

			return updated;
		});
	}

	async remove(id) {
		return this.#withLock(async () => {
			const current = await this.get(id);
			if (!current) return false;
			await rm(this.#file(id), { force: true });

			return true;
		});
	}

	async nextQueued() {
		return (await this.list()).find((job) => job.status === 'queued') || null;
	}

	async queuePosition(id) {
		const queued = (await this.list()).filter((job) => job.status === 'queued');
		const index = queued.findIndex((job) => job.id === id);

		return index === -1 ? null : index + 1;
	}

	async recoverInterrupted(maxAttempts) {
		const recoveryUpdates = [];
		for (const job of await this.list()) {
			if (job.status === 'cancelling') {
				const now = timestamp();
				recoveryUpdates.push(
					this.update(job.id, {
						status: 'cancelled',
						cancelledAt: now,
						completedAt: now,
						error: null,
						metrics: interruptRunningExecutions(job, now),
						notification: createPendingNotification(now),
						progress: {
							stage: 'cancelled',
							message: 'İptal isteği worker yeniden başlatılırken tamamlandı.',
							updatedAt: now,
						},
					}),
				);
				continue;
			}
			if (job.status !== 'running') continue;
			const unsafeStage = ['saving-draft', 'publishing'].includes(job.progress?.stage);
			if (unsafeStage || job.attempts >= maxAttempts) {
				const now = timestamp();
				recoveryUpdates.push(
					this.update(job.id, {
						status: 'failed',
						completedAt: now,
						failureStage: job.progress?.stage || 'running',
						metrics: interruptRunningExecutions(job, now),
						notification: createPendingNotification(now),
						error: unsafeStage
							? 'Worker restarted during an external write; automatic retry was blocked.'
							: 'Worker restarted after the maximum attempt count was reached.',
						progress: {
							stage: 'failed',
							message: unsafeStage
								? 'Worker dış sisteme yazarken yeniden başladı; güvenlik için otomatik tekrar engellendi.'
								: 'Worker yeniden başladı; azami deneme sayısına ulaşıldı.',
							updatedAt: now,
						},
					}),
				);
			} else {
				const now = timestamp();
				recoveryUpdates.push(
					this.update(job.id, {
						status: 'queued',
						startedAt: null,
						error: 'Worker restarted; job returned to the queue.',
						metrics: interruptRunningExecutions(job, now),
						progress: {
							stage: 'queued',
							message: 'Worker yeniden başladı; iş tekrar kuyruğa alındı.',
							updatedAt: now,
						},
					}),
				);
			}
		}
		await Promise.all(recoveryUpdates);
	}
}

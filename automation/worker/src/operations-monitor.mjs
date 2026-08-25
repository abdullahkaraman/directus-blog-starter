import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HOUR_MS = 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DELIVERY_LEASE_MS = 2 * 60 * 1000;

function timestamp(value) {
	return (value instanceof Date ? value : new Date(value ?? Date.now())).toISOString();
}

async function readJson(file) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

async function atomicWrite(file, value) {
	await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await rename(temporary, file);
}

function recentFailureCounts(jobs, nowMs) {
	const since = nowMs - HOUR_MS;
	const safeJobs = Array.isArray(jobs) ? jobs : [];
	const jobFailures = safeJobs.filter(
		(job) =>
			job.status === 'failed' && Number.isFinite(Date.parse(job.completedAt)) && Date.parse(job.completedAt) >= since,
	).length;
	const learningFailures = safeJobs.flatMap((job) =>
		(Array.isArray(job.metrics?.executions) ? job.metrics.executions : []).flatMap((execution) =>
			execution.role === 'learning' &&
			['failed', 'interrupted'].includes(execution.status) &&
			Number.isFinite(Date.parse(execution.completedAt)) &&
			Date.parse(execution.completedAt) >= since
				? [execution]
				: [],
		),
	).length;

	return { jobFailures, learningFailures };
}

function notificationFor(key, condition, now) {
	return {
		id: `op_${randomUUID()}`,
		key,
		severity: condition.severity,
		message: condition.message,
		createdAt: timestamp(now),
		deliveryAttempts: 0,
		leasedUntil: null,
	};
}

function errorMessage(sensor, error) {
	const detail = error instanceof Error ? error.message : String(error);

	return `${sensor}: ${detail.slice(0, 300)}`;
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validStoredState(value) {
	if (!isPlainObject(value) || ![1, 2].includes(value.schemaVersion) || !isPlainObject(value.conditions)) return false;

	return Object.values(value.conditions).every(
		(condition) =>
			isPlainObject(condition) &&
			typeof condition.active === 'boolean' &&
			(!condition.pendingNotification ||
				(isPlainObject(condition.pendingNotification) &&
					/^op_[a-f0-9-]{36}$/.test(String(condition.pendingNotification.id || '')))),
	);
}

function severityRank(value) {
	return { recovery: 0, warning: 1, critical: 2 }[value] ?? -1;
}

export class OperationsMonitor {
	#stateFile;
	#dataDir;
	#backupStatusFile;
	#backupMaxAgeHours;
	#failureAlertThreshold;
	#learningFailureAlertThreshold;
	#alertDedupeHours;
	#statfs;
	#now;
	#lock = Promise.resolve();

	constructor({
		stateFile,
		dataDir,
		backupStatusFile,
		backupMaxAgeHours = 36,
		failureAlertThreshold = 3,
		learningFailureAlertThreshold = 2,
		alertDedupeHours = 6,
		statfsFn = statfs,
		now = () => new Date(),
	}) {
		this.#stateFile = stateFile;
		this.#dataDir = dataDir;
		this.#backupStatusFile = backupStatusFile;
		this.#backupMaxAgeHours = backupMaxAgeHours;
		this.#failureAlertThreshold = failureAlertThreshold;
		this.#learningFailureAlertThreshold = learningFailureAlertThreshold;
		this.#alertDedupeHours = alertDedupeHours;
		this.#statfs = statfsFn;
		this.#now = now;
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

	async ack(notificationIds) {
		return this.#withLock(async () => {
			const requested = new Set(
				(Array.isArray(notificationIds) ? notificationIds : [])
					.flatMap((id) => {
						const normalizedId = String(id || '').trim();

						return /^op_[a-f0-9-]{36}$/.test(normalizedId) ? [normalizedId] : [];
					})
					.slice(0, 100),
			);
			const state = (await readJson(this.#stateFile)) || { schemaVersion: 2, conditions: {} };
			const acknowledged = [];
			const now = this.#now();
			for (const condition of Object.values(state.conditions || {})) {
				const pending = condition?.pendingNotification;
				if (!pending || !requested.has(pending.id)) continue;
				condition.lastNotifiedAt = timestamp(now);
				condition.lastAcknowledgedNotificationId = pending.id;
				condition.pendingNotification = null;
				condition.updatedAt = timestamp(now);
				acknowledged.push(pending.id);
			}
			state.schemaVersion = 2;
			state.updatedAt = timestamp(now);
			await atomicWrite(this.#stateFile, state);

			return { acknowledged };
		});
	}

	async check({ jobs, memoryHealth }) {
		return this.#withLock(async () => {
			const now = this.#now();
			const nowMs = now.getTime();
			const sensorErrors = [];
			let filesystem = null;
			let backupStatus = null;
			let storedState = null;

			try {
				filesystem = await this.#statfs(this.#dataDir);
			} catch (error) {
				sensorErrors.push(errorMessage('disk sensörü', error));
			}
			try {
				backupStatus = await readJson(this.#backupStatusFile);
			} catch (error) {
				sensorErrors.push(errorMessage('yedek sensörü', error));
			}
			try {
				storedState = await readJson(this.#stateFile);
				if (storedState && !validStoredState(storedState)) {
					sensorErrors.push('operasyon durumu: state şeması geçersiz');
					storedState = null;
				}
			} catch (error) {
				sensorErrors.push(errorMessage('operasyon durumu', error));
			}

			let diskUsedPercent = null;
			const conditions = {};
			if (filesystem) {
				const blocks = Number(filesystem.blocks || 0);
				const available = Number(filesystem.bavail ?? filesystem.bfree ?? 0);
				diskUsedPercent = blocks > 0 ? Math.round((1 - available / blocks) * 1000) / 10 : 0;
				const severity = diskUsedPercent >= 90 ? 'critical' : diskUsedPercent >= 80 ? 'warning' : 'recovery';
				conditions['disk.space'] = {
					active: diskUsedPercent >= 80,
					severity,
					message:
						severity === 'critical'
							? `Kritik disk kullanımı: %${diskUsedPercent}.`
							: `Disk kullanımı uyarı eşiğinde: %${diskUsedPercent}.`,
				};
			}

			let backupAgeHours = null;
			if (!sensorErrors.some((message) => message.startsWith('yedek sensörü:'))) {
				const backupCompletedMs = Date.parse(backupStatus?.completedAt);
				const validBackup =
					backupStatus?.validation === 'restic-check-passed' &&
					Number.isFinite(backupCompletedMs) &&
					backupCompletedMs <= nowMs + FUTURE_CLOCK_SKEW_MS;
				backupAgeHours = validBackup ? Math.max(0, (nowMs - backupCompletedMs) / HOUR_MS) : null;
				conditions['backup.stale'] = {
					active: backupAgeHours === null || backupAgeHours > this.#backupMaxAgeHours,
					severity: 'warning',
					message:
						backupAgeHours === null
							? 'Geçerli ve Restic kontrolünden geçmiş bir yedek kaydı bulunamadı.'
							: `Son doğrulanmış yedek ${Math.floor(backupAgeHours)} saat önce alındı.`,
				};
			}

			let jobFailures = null;
			let learningFailures = null;
			try {
				({ jobFailures, learningFailures } = recentFailureCounts(jobs, nowMs));
				conditions['jobs.failures'] = {
					active: jobFailures >= this.#failureAlertThreshold,
					severity: 'warning',
					message: `Son bir saatte ${jobFailures} içerik işi başarısız oldu.`,
				};
				conditions['learning.failures'] = {
					active: learningFailures >= this.#learningFailureAlertThreshold,
					severity: 'warning',
					message: `Son bir saatte ${learningFailures} yayın sonrası öğrenme çağrısı başarısız oldu.`,
				};
			} catch (error) {
				sensorErrors.push(errorMessage('iş metriği sensörü', error));
			}

			conditions['memory.corrupt'] = {
				active: !memoryHealth?.ok,
				severity: 'critical',
				message: `Editoryal hafıza kullanılamıyor (${memoryHealth?.code || 'bilinmeyen hata'}). İçerik işleri güvenlik için kapalı.`,
			};
			conditions['monitor.internal'] = {
				active: sensorErrors.length > 0,
				severity: 'critical',
				message: `Operasyon denetiminin bazı sensörleri çalışmadı: ${sensorErrors.join(' | ')}`,
			};

			const state = storedState || { schemaVersion: 2, conditions: {} };
			for (const [key, condition] of Object.entries(conditions)) {
				const previous = state.conditions[key] || {
					active: false,
					severity: null,
					lastNotifiedAt: null,
					pendingNotification: null,
				};
				const lastNotifiedMs = Date.parse(previous.lastNotifiedAt);
				const elapsed = Number.isFinite(lastNotifiedMs) ? nowMs - lastNotifiedMs : Number.POSITIVE_INFINITY;
				if (condition.active) {
					const escalated = previous.active && severityRank(condition.severity) > severityRank(previous.severity);
					const deescalated = previous.active && severityRank(condition.severity) < severityRank(previous.severity);
					const resurfaced = !previous.active && previous.pendingNotification?.severity === 'recovery';
					if (escalated || resurfaced) previous.pendingNotification = null;
					if (deescalated && previous.pendingNotification) {
						previous.pendingNotification = {
							...previous.pendingNotification,
							severity: condition.severity,
							message: condition.message,
						};
					}
					if (
						!previous.pendingNotification &&
						(!previous.active || escalated || elapsed >= this.#alertDedupeHours * HOUR_MS)
					) {
						previous.pendingNotification = notificationFor(key, condition, now);
					}
				} else if (previous.active) {
					const deliveryUnconfirmed = Boolean(previous.pendingNotification);
					previous.pendingNotification = notificationFor(
						key,
						{
							severity: 'recovery',
							message: deliveryUnconfirmed
								? `Düzeldi: ${key}. Önceki uyarının teslim onayı alınamamıştı.`
								: `Düzeldi: ${key}`,
						},
						now,
					);
				}
				previous.active = condition.active;
				previous.severity = condition.active ? condition.severity : null;
				previous.updatedAt = timestamp(now);
				state.conditions[key] = previous;
			}
			const notifications = [];
			for (const condition of Object.values(state.conditions)) {
				const pending = condition?.pendingNotification;
				if (!pending) continue;
				// Recovery is informational and must not repeat every monitor cycle when
				// the downstream delivery ACK is lost. Active alerts remain retryable.
				if (pending.severity === 'recovery' && pending.deliveryAttempts > 0) continue;
				const leasedUntilMs = Date.parse(pending.leasedUntil);
				if (Number.isFinite(leasedUntilMs) && leasedUntilMs > nowMs) continue;
				pending.deliveryAttempts = Number.isSafeInteger(pending.deliveryAttempts) ? pending.deliveryAttempts + 1 : 1;
				pending.leasedUntil = new Date(nowMs + DELIVERY_LEASE_MS).toISOString();
				notifications.push({ ...pending });
			}
			state.schemaVersion = 2;
			state.updatedAt = timestamp(now);
			await atomicWrite(this.#stateFile, state);

			return {
				checkedAt: timestamp(now),
				diskUsedPercent,
				backupAgeHours,
				jobFailures,
				learningFailures,
				memoryHealthy: Boolean(memoryHealth?.ok),
				notifications,
			};
		});
	}
}

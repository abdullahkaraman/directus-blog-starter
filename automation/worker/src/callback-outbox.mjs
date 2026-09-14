const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function asDate(value) {
	const date = value instanceof Date ? value : new Date(value ?? Date.now());
	if (!Number.isFinite(date.getTime())) throw new TypeError('Callback outbox received an invalid date.');

	return date;
}

function errorMessage(error) {
	return String(error instanceof Error ? error.message : error).slice(0, 1_000);
}

export function createPendingNotification(now = new Date()) {
	const at = asDate(now).toISOString();
	return {
		status: 'pending',
		attempts: 0,
		nextAttemptAt: at,
		lastAttemptAt: null,
		sentAt: null,
		lastError: null,
	};
}

export function createSentNotification(now = new Date(), channel = 'callback') {
	const at = asDate(now).toISOString();
	return {
		status: 'sent',
		attempts: channel === 'callback' ? 1 : 0,
		nextAttemptAt: null,
		lastAttemptAt: channel === 'callback' ? at : null,
		sentAt: at,
		lastError: null,
		channel,
	};
}

function isDue(notification, nowMs) {
	if (notification?.status !== 'pending') return false;
	if (!notification.nextAttemptAt) return true;
	const nextAttemptMs = Date.parse(notification.nextAttemptAt);

	return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
}

export class CallbackOutbox {
	#store;
	#callbackUrl;
	#callbackToken;
	#serializeJob;
	#fetch;
	#now;
	#delivering = new Set();
	#flushPromise = null;

	constructor({
		store,
		callbackUrl,
		callbackToken,
		serializeJob = (job) => job,
		fetchFn = globalThis.fetch,
		now = () => new Date(),
	}) {
		this.#store = store;
		this.#callbackUrl = callbackUrl;
		this.#callbackToken = callbackToken;
		this.#serializeJob = serializeJob;
		this.#fetch = fetchFn;
		this.#now = now;
	}

	#nowDate() {
		return asDate(this.#now());
	}

	#retryAt(attempts, now) {
		const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));

		return new Date(now.getTime() + delayMs).toISOString();
	}

	async deliver(jobId) {
		if (!this.#callbackUrl || !this.#callbackToken || this.#delivering.has(jobId)) return false;
		this.#delivering.add(jobId);
		try {
			const current = await this.#store.get(jobId);
			const now = this.#nowDate();
			if (!current || !TERMINAL_JOB_STATUSES.has(current.status) || !isDue(current.notification, now.getTime())) {
				return false;
			}
			const attempts = Number.isSafeInteger(current.notification.attempts) ? current.notification.attempts + 1 : 1;
			const attempting = await this.#store.mutate(jobId, (candidate) => {
				if (!TERMINAL_JOB_STATUSES.has(candidate.status) || !isDue(candidate.notification, now.getTime())) return null;

				return {
					notification: {
						...candidate.notification,
						status: 'pending',
						attempts,
						lastAttemptAt: now.toISOString(),
						nextAttemptAt: null,
					},
				};
			});
			if (attempting?.notification?.status !== 'pending' || attempting.notification.attempts !== attempts) return false;

			try {
				const response = await this.#fetch(this.#callbackUrl, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${this.#callbackToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(this.#serializeJob(attempting)),
					signal: AbortSignal.timeout(15_000),
				});
				if (!response.ok) throw new Error(`n8n callback failed with HTTP ${response.status}.`);
				await this.#store.mutate(jobId, (candidate) => {
					if (candidate.notification?.status !== 'pending' || candidate.notification.attempts !== attempts) return null;

					return {
						notification: {
							...candidate.notification,
							status: 'sent',
							nextAttemptAt: null,
							sentAt: now.toISOString(),
							lastError: null,
							channel: 'callback',
						},
					};
				});

				return true;
			} catch (error) {
				await this.#store.mutate(jobId, (candidate) => {
					if (candidate.notification?.status !== 'pending' || candidate.notification.attempts !== attempts) return null;

					return {
						notification: {
							...candidate.notification,
							nextAttemptAt: this.#retryAt(attempts, now),
							lastError: errorMessage(error),
						},
					};
				});

				return false;
			}
		} finally {
			this.#delivering.delete(jobId);
		}
	}

	async flush() {
		if (this.#flushPromise) return this.#flushPromise;
		this.#flushPromise = (async () => {
			const nowMs = this.#nowDate().getTime();
			const pending = (await this.#store.list()).filter(
				(job) => TERMINAL_JOB_STATUSES.has(job.status) && isDue(job.notification, nowMs),
			);
			await Promise.all(pending.map((job) => this.deliver(job.id)));

			return pending.length;
		})();
		try {
			return await this.#flushPromise;
		} finally {
			this.#flushPromise = null;
		}
	}
}

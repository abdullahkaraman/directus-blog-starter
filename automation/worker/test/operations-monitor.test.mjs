import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { OperationsMonitor } from '../src/operations-monitor.mjs';

test('operations monitor retries unacknowledged alerts, deduplicates acknowledged alerts and emits recovery', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	let now = new Date('2026-07-21T12:00:00.000Z');
	const backupStatusFile = path.join(root, 'backup.json');
	await writeFile(
		backupStatusFile,
		JSON.stringify({ completedAt: '2026-07-21T11:00:00.000Z', validation: 'restic-check-passed' }),
	);
	let available = 15;
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile,
		statfsFn: async () => ({ blocks: 100, bavail: available }),
		now: () => now,
	});
	const input = { jobs: [], memoryHealth: { ok: true } };
	const first = await monitor.check(input);
	assert.deepEqual(first.notifications.map((item) => item.key), ['disk.space']);
	const duplicate = await monitor.check(input);
	assert.equal(duplicate.notifications.length, 0);
	now = new Date('2026-07-21T12:02:01.000Z');
	const leasedRetry = await monitor.check(input);
	assert.equal(leasedRetry.notifications[0].id, first.notifications[0].id);
	assert.deepEqual((await monitor.ack([first.notifications[0].id])).acknowledged, [first.notifications[0].id]);
	assert.equal((await monitor.check(input)).notifications.length, 0);

	now = new Date('2026-07-21T18:03:00.000Z');
	const reminder = await monitor.check(input);
	assert.deepEqual(reminder.notifications.map((item) => item.key), ['disk.space']);
	await monitor.ack([reminder.notifications[0].id]);
	available = 50;
	assert.deepEqual((await monitor.check(input)).notifications.map((item) => item.severity), ['recovery']);
});

test('operations monitor detects stale backups and hourly failure thresholds', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile: path.join(root, 'missing-backup.json'),
		statfsFn: async () => ({ blocks: 100, bavail: 80 }),
		now: () => new Date('2026-07-21T12:00:00.000Z'),
	});
	const failedJob = (index) => ({
		id: `failed-${index}`,
		status: 'failed',
		completedAt: '2026-07-21T11:30:00.000Z',
		metrics: {
			executions: index < 2 ? [{ role: 'learning', status: 'failed', completedAt: '2026-07-21T11:40:00.000Z' }] : [],
		},
	});
	const result = await monitor.check({ jobs: [failedJob(0), failedJob(1), failedJob(2)], memoryHealth: { ok: false, code: 'EDITORIAL_MEMORY_CORRUPT' } });
	assert.deepEqual(
		new Set(result.notifications.map((item) => item.key)),
		new Set(['backup.stale', 'jobs.failures', 'learning.failures', 'memory.corrupt']),
	);
});

test('operations monitor replaces a pending disk warning with a critical alert without a false recovery', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const backupStatusFile = path.join(root, 'backup.json');
	await writeFile(
		backupStatusFile,
		JSON.stringify({ completedAt: '2026-07-21T11:00:00.000Z', validation: 'restic-check-passed' }),
	);
	let available = 15;
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile,
		statfsFn: async () => ({ blocks: 100, bavail: available }),
		now: () => new Date('2026-07-21T12:00:00.000Z'),
	});
	const warning = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	available = 5;
	const critical = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	assert.equal(critical.notifications.length, 1);
	assert.equal(critical.notifications[0].key, 'disk.space');
	assert.equal(critical.notifications[0].severity, 'critical');
	assert.notEqual(critical.notifications[0].id, warning.notifications[0].id);
});

test('operations monitor isolates broken sensors and rejects invalid or future backup status', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const backupStatusFile = path.join(root, 'backup.json');
	await writeFile(
		backupStatusFile,
		JSON.stringify({ completedAt: '2026-07-22T12:00:00.000Z', validation: 'not-validated' }),
	);
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile,
		statfsFn: async () => {
			throw new Error('statfs unavailable');
		},
		now: () => new Date('2026-07-21T12:00:00.000Z'),
	});
	const result = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	assert.equal(result.diskUsedPercent, null);
	assert.equal(result.backupAgeHours, null);
	assert.deepEqual(
		new Set(result.notifications.map((item) => item.key)),
		new Set(['backup.stale', 'monitor.internal']),
	);
});

test('operations monitor replaces an unacknowledged recovery when the condition resurfaces', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const backupStatusFile = path.join(root, 'backup.json');
	await writeFile(
		backupStatusFile,
		JSON.stringify({ completedAt: '2026-07-21T11:00:00.000Z', validation: 'restic-check-passed' }),
	);
	let available = 15;
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile,
		statfsFn: async () => ({ blocks: 100, bavail: available }),
		now: () => new Date('2026-07-21T12:00:00.000Z'),
	});
	const alert = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	await monitor.ack([alert.notifications[0].id]);
	available = 50;
	const recovery = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	assert.equal(recovery.notifications[0].severity, 'recovery');
	available = 15;
	const resurfaced = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	assert.equal(resurfaced.notifications[0].severity, 'warning');
	assert.notEqual(resurfaced.notifications[0].id, recovery.notifications[0].id);
});

test('operations monitor reports recovery even when the previous alert ACK was lost', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const backupStatusFile = path.join(root, 'backup.json');
	await writeFile(
		backupStatusFile,
		JSON.stringify({ completedAt: '2026-07-21T11:00:00.000Z', validation: 'restic-check-passed' }),
	);
	let available = 15;
	let now = new Date('2026-07-21T12:00:00.000Z');
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile,
		statfsFn: async () => ({ blocks: 100, bavail: available }),
		now: () => now,
	});
	await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	available = 50;
	const recovery = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	assert.equal(recovery.notifications[0].severity, 'recovery');
	assert.match(recovery.notifications[0].message, /teslim onayı alınamamıştı/);
	now = new Date('2026-07-21T12:10:00.000Z');
	assert.equal((await monitor.check({ jobs: [], memoryHealth: { ok: true } })).notifications.length, 0);
});

test('operations monitor does not treat disk critical-to-warning as an escalation', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operations-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const backupStatusFile = path.join(root, 'backup.json');
	await writeFile(
		backupStatusFile,
		JSON.stringify({ completedAt: '2026-07-21T11:00:00.000Z', validation: 'restic-check-passed' }),
	);
	let available = 5;
	const monitor = new OperationsMonitor({
		stateFile: path.join(root, 'state.json'),
		dataDir: root,
		backupStatusFile,
		statfsFn: async () => ({ blocks: 100, bavail: available }),
		now: () => new Date('2026-07-21T12:00:00.000Z'),
	});
	const critical = await monitor.check({ jobs: [], memoryHealth: { ok: true } });
	available = 15;
	assert.equal((await monitor.check({ jobs: [], memoryHealth: { ok: true } })).notifications.length, 0);
	assert.equal(critical.notifications[0].severity, 'critical');
});

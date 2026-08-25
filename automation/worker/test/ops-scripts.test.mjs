import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const automationDirectory = fileURLToPath(new URL('../../', import.meta.url));
const opsDirectory = path.join(automationDirectory, 'ops');

function runShell(script, args = [], options = {}) {
	return spawnSync('sh', [path.join(opsDirectory, script), ...args], {
		encoding: 'utf8',
		...options,
	});
}

async function writeSecureEnvironment(file, values) {
	await writeFile(
		file,
		Object.entries(values)
			.map(([key, value]) => `${key}=${value}`)
			.join('\n') + '\n',
	);
	await chmod(file, 0o600);
}

test('operation scripts have valid POSIX shell syntax and working help', () => {
	for (const script of ['backup.sh', 'init-restic.sh', 'lib.sh', 'restore.sh', 'watchdog.sh']) {
		const syntax = spawnSync('sh', ['-n', path.join(opsDirectory, script)], { encoding: 'utf8' });
		assert.equal(syntax.status, 0, `${script}: ${syntax.stderr}`);
	}

	for (const script of ['backup.sh', 'init-restic.sh', 'restore.sh', 'watchdog.sh']) {
		const help = runShell(script, ['--help']);
		assert.equal(help.status, 0, `${script}: ${help.stderr}`);
		assert.match(help.stdout, /Usage:/);
	}
});

test('watchdog rejects an environment file with broad permissions', async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'content-ops-watchdog-mode-'));
	const environmentFile = path.join(temporaryDirectory, 'automation.env');
	await writeFile(environmentFile, 'TELEGRAM_BOT_TOKEN=123456:test\n');
	await chmod(environmentFile, 0o644);

	const result = runShell('watchdog.sh', ['--env-file', environmentFile]);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /permissions must be 0600 or 0400/);
});

test('watchdog suppresses expected maintenance downtime and keeps Telegram token out of argv', async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'content-ops-watchdog-maintenance-'));
	const stateDirectory = path.join(temporaryDirectory, 'state');
	const backupDirectory = path.join(temporaryDirectory, 'backup');
	const fakeBinaryDirectory = path.join(temporaryDirectory, 'bin');
	const environmentFile = path.join(temporaryDirectory, 'automation.env');
	const markerFile = path.join(backupDirectory, 'maintenance.state');
	const argumentLog = path.join(temporaryDirectory, 'curl-arguments.log');
	const configLog = path.join(temporaryDirectory, 'curl-config.log');
	const token = '123456:SUPER_SECRET_TEST_TOKEN';
	await mkdir(stateDirectory);
	await mkdir(backupDirectory);
	await mkdir(fakeBinaryDirectory);
	await writeSecureEnvironment(environmentFile, {
		TELEGRAM_BOT_TOKEN: token,
		TELEGRAM_ALERT_CHAT_ID: '7244086980',
		WATCHDOG_STATE_DIR: stateDirectory,
		WATCHDOG_DEDUPE_SECONDS: '60',
		WATCHDOG_MAINTENANCE_MAX_SECONDS: '7200',
		MAINTENANCE_MARKER_FILE: markerFile,
	});
	await writeFile(
		path.join(fakeBinaryDirectory, 'curl'),
		'#!/bin/sh\nprintf "%s\\n" "$*" >>"$CURL_ARGUMENT_LOG"\ncat >>"$CURL_CONFIG_LOG"\nexit 0\n',
	);
	await chmod(path.join(fakeBinaryDirectory, 'curl'), 0o700);

	const currentEpoch = Math.floor(Date.now() / 1000);
	await writeFile(markerFile, `operation=backup\npid=123\nstarted_epoch=${currentEpoch}\nhost=test-host\nsuppress_health=1\n`);
	await chmod(markerFile, 0o600);
	const childEnvironment = {
		...process.env,
		PATH: `${fakeBinaryDirectory}:${process.env.PATH}`,
		CURL_ARGUMENT_LOG: argumentLog,
		CURL_CONFIG_LOG: configLog,
	};

	const suppressed = runShell('watchdog.sh', ['--env-file', environmentFile], { env: childEnvironment });
	assert.equal(suppressed.status, 0, suppressed.stderr);
	assert.match(suppressed.stdout, /active maintenance marker/);

	await writeFile(markerFile, 'operation=backup\npid=123\nstarted_epoch=\nhost=test-host\nsuppress_health=1\n');
	const stale = runShell('watchdog.sh', ['--env-file', environmentFile], { env: childEnvironment });
	assert.equal(stale.status, 0, stale.stderr);
	const argumentsSeen = await readFile(argumentLog, 'utf8');
	const configSeen = await readFile(configLog, 'utf8');
	assert.doesNotMatch(argumentsSeen, new RegExp(token));
	assert.match(configSeen, new RegExp(`https://api\\.telegram\\.org/bot${token}/sendMessage`));

	await mkdir(path.join(stateDirectory, '.watchdog.lock'));
	await writeFile(path.join(stateDirectory, '.watchdog.lock', 'pid'), `${process.pid}\n`);
	const overlapping = runShell('watchdog.sh', ['--env-file', environmentFile], { env: childEnvironment });
	assert.equal(overlapping.status, 0, overlapping.stderr);
	assert.match(overlapping.stdout, /another check is active/);
});

test('restore rejects unsafe snapshot selectors and incomplete cross-host intent before download', async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'content-ops-restore-arguments-'));
	const fakeBinaryDirectory = path.join(temporaryDirectory, 'bin');
	const backupDirectory = path.join(temporaryDirectory, 'backup');
	const environmentFile = path.join(temporaryDirectory, 'automation.env');
	await mkdir(fakeBinaryDirectory);
	await writeSecureEnvironment(environmentFile, {
		RESTIC_REPOSITORY: 's3:https://example.invalid/test',
		RESTIC_PASSWORD: 'test-password',
		AWS_ACCESS_KEY_ID: 'test-access-key',
		AWS_SECRET_ACCESS_KEY: 'test-secret-key',
		BACKUP_DIR: backupDirectory,
		BACKUP_PROJECT_ID: 'content-ops',
	});
	await writeFile(path.join(fakeBinaryDirectory, 'restic'), '#!/bin/sh\n[ "$1" = snapshots ]\n');
	await writeFile(path.join(fakeBinaryDirectory, 'docker'), '#!/bin/sh\nexit 0\n');
	await chmod(path.join(fakeBinaryDirectory, 'restic'), 0o700);
	await chmod(path.join(fakeBinaryDirectory, 'docker'), 0o700);
	const childEnvironment = {
		...process.env,
		PATH: `${fakeBinaryDirectory}:${process.env.PATH}`,
	};

	const unsafeSnapshot = runShell(
		'restore.sh',
		['--env-file', environmentFile, '--snapshot', '../latest'],
		{ env: childEnvironment },
	);
	assert.notEqual(unsafeSnapshot.status, 0);
	assert.match(unsafeSnapshot.stderr, /8-64 character hexadecimal/);

	const incompleteCrossHost = runShell(
		'restore.sh',
		['--env-file', environmentFile, '--snapshot', 'deadbeef', '--allow-cross-host'],
		{ env: childEnvironment },
	);
	assert.notEqual(incompleteCrossHost.status, 0);
	assert.match(incompleteCrossHost.stderr, /requires --source-host HOST/);
});

test('restore source retains destructive-operation safety invariants', async () => {
	const restoreSource = await readFile(path.join(opsDirectory, 'restore.sh'), 'utf8');
	assert.match(restoreSource, /restic restore --target "\$RESTORE_ROOT" -- "\$SNAPSHOT"/);
	assert.match(restoreSource, /DROP DATABASE IF EXISTS :"target_db";/);
	assert.match(restoreSource, /CREATE DATABASE :"target_db" OWNER :"target_owner";/);
	assert.match(restoreSource, /acquire_maintenance_lock restore/);
	assert.match(restoreSource, /assert_service_stopped n8n/);
	assert.match(restoreSource, /assert_service_stopped codex-worker/);
});

test('backup status and worker bootstrap retain their runtime ownership boundaries', async () => {
	const backupSource = await readFile(path.join(opsDirectory, 'backup.sh'), 'utf8');
	const entrypointSource = await readFile(path.join(automationDirectory, 'worker/docker-entrypoint.sh'), 'utf8');

	assert.match(backupSource, /--user 1000:1000/);
	assert.match(entrypointSource, /unset WORKER_API_TOKEN DIRECTUS_TOKEN DRAFT_PREVIEW_SECRET N8N_CALLBACK_TOKEN/);
	assert.match(entrypointSource, /if \[ "\$\{1:-\}" = node \] && \[ "\$\{2:-\}" = src\/server\.mjs \]/);
	assert.match(
		entrypointSource,
		/exec setpriv --reuid=1000 --regid=1000 --clear-groups --no-new-privs "\$@"/,
	);
});

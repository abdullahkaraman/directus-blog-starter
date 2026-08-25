import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function workerResultWorkflow() {
	return JSON.parse(await readFile(path.resolve(workerDir, '../n8n/worker-result.json'), 'utf8'));
}

async function workflow(name) {
	return JSON.parse(await readFile(path.resolve(workerDir, `../n8n/${name}.json`), 'utf8'));
}

async function telegramSubmitWorkflow() {
	return JSON.parse(await readFile(path.resolve(workerDir, '../n8n/telegram-submit.json'), 'utf8'));
}

async function operationsWorkflow() {
	return JSON.parse(await readFile(path.resolve(workerDir, '../n8n/operations-watchdog.json'), 'utf8'));
}

async function composeFile() {
	return readFile(path.resolve(workerDir, '../docker-compose.yml'), 'utf8');
}

function executeFormatter(code, job) {
	return Function('$json', code)(job)[0].json.text;
}

test('worker callback waits for Telegram delivery and records job-status dedupe only after send', async () => {
	const workflow = await workerResultWorkflow();
	const webhook = workflow.nodes.find((node) => node.name === 'Codex Result Webhook');
	const dedupe = workflow.nodes.find((node) => node.name === 'Callback Tekrarını Engelle');
	const mark = workflow.nodes.find((node) => node.name === 'Callback Teslimini Kaydet');

	assert.equal(webhook.parameters.responseMode, 'lastNode');
	assert.match(dedupe.parameters.jsCode, /`\$\{job\.id\}:\$\{job\.status\}`/);
	assert.match(mark.parameters.jsCode, /callbackDeliveries\[deliveryKey\]/);
	assert.equal(workflow.connections['Telegram Sonuç Mesajı'].main[0][0].node, 'Callback Teslimini Kaydet');
});

test('n8n workflows isolate secrets from Code nodes and use encrypted Header Auth credentials', async () => {
	const telegram = await telegramSubmitWorkflow();
	const result = await workerResultWorkflow();
	const operations = await operationsWorkflow();
	const telegramCode = telegram.nodes.filter((node) => node.type === 'n8n-nodes-base.code');
	const resultCode = result.nodes.filter((node) => node.type === 'n8n-nodes-base.code');
	const operationsCode = operations.nodes.filter((node) => node.type === 'n8n-nodes-base.code');
	const normalize = telegram.nodes.find((node) => node.name === 'Yetkilendir ve Normalize Et');
	const enqueue = telegram.nodes.find((node) => node.name === "Codex Worker'a Gönder");
	const webhook = result.nodes.find((node) => node.name === 'Codex Result Webhook');
	const verify = result.nodes.find((node) => node.name === 'Callback Doğrula');
	const operationsRequests = operations.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');

	for (const node of [...telegramCode, ...resultCode, ...operationsCode]) {
		assert.doesNotMatch(node.parameters.jsCode, /\$env\./);
		assert.doesNotMatch(node.parameters.jsCode, /\$vars\./);
	}
	assert.match(normalize.parameters.jsCode, /message\.chat\.type === 'private'/);
	const operationsFormatter = operations.nodes.find((node) => node.name === 'Uyarıları Hazırla');
	assert.match(operationsFormatter.parameters.jsCode, /\$json\.telegramChatId/);
	assert.equal(enqueue.parameters.authentication, 'genericCredentialType');
	assert.equal(enqueue.parameters.genericAuthType, 'httpHeaderAuth');
	assert.equal(enqueue.credentials.httpHeaderAuth.name, 'Content Ops — Worker API Bearer');
	assert.equal(enqueue.parameters.headerParameters, undefined);
	assert.equal(webhook.parameters.authentication, 'headerAuth');
	assert.equal(webhook.credentials.httpHeaderAuth.name, 'Content Ops — Callback Bearer');
	assert.match(verify.parameters.jsCode, /Invalid worker callback payload/);
	assert.doesNotMatch(verify.parameters.jsCode, /N8N_CALLBACK_TOKEN|authorization/i);
	assert.equal(operationsRequests.length, 2);
	for (const node of operationsRequests) {
		assert.equal(node.parameters.authentication, 'genericCredentialType');
		assert.equal(node.parameters.genericAuthType, 'httpHeaderAuth');
		assert.equal(node.credentials.httpHeaderAuth.name, 'Content Ops — Worker API Bearer');
		assert.equal(node.parameters.headerParameters, undefined);
	}
});

test('n8n container blocks Code-node environment access and does not receive worker secrets', async () => {
	const compose = await composeFile();
	const n8nStart = compose.indexOf('\n  n8n:');
	const workerStart = compose.indexOf('\n  codex-worker:');
	assert.ok(n8nStart >= 0 && workerStart > n8nStart);
	const n8nService = compose.slice(n8nStart, workerStart);
	const workerService = compose.slice(workerStart);

	assert.match(n8nService, /N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true'/);
	for (const name of [
		'TELEGRAM_ALLOWED_USER_ID',
		'TELEGRAM_ALLOWED_CHAT_ID',
		'WORKER_API_TOKEN',
		'N8N_CALLBACK_TOKEN',
	]) {
		assert.doesNotMatch(n8nService, new RegExp(`\\b${name}\\b`));
		assert.match(workerService, new RegExp(`\\b${name}\\b`));
	}
});

test('Telegram result formatter keeps action commands at the end within 4096 characters', async () => {
	const workflow = await workerResultWorkflow();
	const code = workflow.nodes.find((node) => node.name === 'Sonucu Biçimlendir').parameters.jsCode;
	const id = 'bb549ac3-1710-4e7e-930b-76cac45c7685';
	const text = executeFormatter(code, {
		id,
		status: 'completed',
		telegramChatId: '1',
		deliveryKey: `${id}:completed`,
		result: {
			kind: 'article',
			title: 'Uzun kontrol notlu yazı',
			readTime: 10,
			previewUrl: 'https://example.com/preview',
			warnings: ['<&'.repeat(3_000)],
		},
	});

	assert.ok(text.length <= 4_096);
	assert.doesNotMatch(text, /<|&(?!amp;|lt;|gt;)/);
	assert.ok(text.endsWith(`/yayinla ${id}`));
});

test('Telegram result workflow escapes dynamic HTML before using HTML parse mode', async () => {
	const workflow = await workerResultWorkflow();
	const code = workflow.nodes.find((node) => node.name === 'Sonucu Biçimlendir').parameters.jsCode;
	const telegram = workflow.nodes.find((node) => node.name === 'Telegram Sonuç Mesajı');
	const text = executeFormatter(code, {
		id: 'learning-job',
		status: 'completed',
		telegramChatId: '1',
		deliveryKey: 'learning-job:completed',
		result: {
			kind: 'learning',
			outcome: 'proposal',
			proposal: { id: 'hm_abcdef123456', text: 'Genel kategori kullan; <özel> & güvenli olsun.' },
		},
	});

	assert.equal(telegram.parameters.additionalFields.parse_mode, 'HTML');
	assert.match(text, /hm_abcdef123456/);
	assert.match(text, /&lt;özel&gt; &amp; güvenli/);
	assert.match(text, /&lt;yeni-kural&gt;/);
	assert.doesNotMatch(text, /<[^>]*>/);
});

test('Telegram result formatter distinguishes learning proposal, none and failure outcomes', async () => {
	const workflow = await workerResultWorkflow();
	const code = workflow.nodes.find((node) => node.name === 'Sonucu Biçimlendir').parameters.jsCode;
	const base = {
		id: 'learning-job',
		telegramChatId: '1',
		deliveryKey: 'learning-job:completed',
	};
	const proposal = executeFormatter(code, {
		...base,
		status: 'completed',
		result: {
			kind: 'learning',
			outcome: 'proposal',
			proposal: { id: 'hm_abcdef123456', text: 'Girişleri doğrudan probleme bağla.' },
		},
	});
	const none = executeFormatter(code, {
		...base,
		status: 'completed',
		result: { kind: 'learning', outcome: 'none', reason: 'Kalıcı ve tekrar eden bir tercih yok.' },
	});
	const failed = executeFormatter(code, {
		...base,
		status: 'failed',
		error: 'timeout',
		result: { kind: 'learning', status: 'failed' },
	});

	assert.match(proposal, /Hafıza önerisi/);
	assert.match(proposal, /\/hafiza_onayla hm_abcdef123456/);
	assert.match(none, /kuralı önermeye gerek görülmedi/);
	assert.match(failed, /yayın bundan etkilenmedi/);
	assert.doesNotMatch(failed, /İçerik işi tamamlanamadı/);
});

test('Telegram result formatter hides retry for ambiguous external-write failures', async () => {
	const workflow = await workerResultWorkflow();
	const code = workflow.nodes.find((node) => node.name === 'Sonucu Biçimlendir').parameters.jsCode;
	const base = {
		id: 'bb549ac3-1710-4e7e-930b-76cac45c7685',
		status: 'failed',
		telegramChatId: '1',
		error: 'connection lost',
	};
	const unsafe = executeFormatter(code, { ...base, failureStage: 'saving-draft' });
	const safe = executeFormatter(code, { ...base, failureStage: 'generating' });

	assert.doesNotMatch(unsafe, /\/tekrar/);
	assert.match(unsafe, /Directus durumunu kontrol et/);
	assert.match(safe, /\/tekrar/);
});

test('n8n workflows use credentials without paid Variables or process environment access', async () => {
	const workflows = await Promise.all([
		workflow('telegram-submit'),
		workflow('worker-result'),
		workflow('operations-watchdog'),
	]);
	assert.doesNotMatch(JSON.stringify(workflows), /\$(?:env|vars)\./);
	const telegram = workflows[0];
	const normalize = telegram.nodes.find((node) => node.name === 'Yetkilendir ve Normalize Et');
	const enqueue = telegram.nodes.find((node) => node.name === "Codex Worker'a Gönder");
	assert.match(normalize.parameters.jsCode, /telegramUserId: String\(message\.from\.id\)/);
	assert.equal(enqueue.parameters.genericAuthType, 'httpHeaderAuth');
	const resultWebhook = workflows[1].nodes.find((node) => node.name === 'Codex Result Webhook');
	assert.equal(resultWebhook.parameters.authentication, 'headerAuth');
	const operations = workflows[2];
	for (const name of ['Operasyonları Kontrol Et', 'Uyarıyı Onayla']) {
		assert.equal(operations.nodes.find((node) => node.name === name).parameters.genericAuthType, 'httpHeaderAuth');
	}
	assert.equal(operations.connections['Telegram Uyarısı'].main[0][0].node, 'Uyarıyı Onayla');
});

test('every imported n8n Code node has valid JavaScript syntax', async () => {
	const workflows = await Promise.all([
		workflow('telegram-submit'),
		workflow('worker-result'),
		workflow('operations-watchdog'),
	]);

	for (const definition of workflows) {
		for (const node of definition.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code')) {
			assert.doesNotThrow(
				() => Function('$input', '$json', '$vars', node.parameters.jsCode),
				`${definition.name} / ${node.name}`,
			);
		}
	}
});

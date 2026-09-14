import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCodexJob, runCodexLearning, runCodexReview } from '../src/codex-runner.mjs';

test('Codex failures surface structured JSON errors without dumping arbitrary stdout', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-error-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-failure.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { text: 'private candidate content' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'Configured model is unavailable.' } }) + '\\n');
process.exit(1);
`,
		{ mode: 0o755 },
	);

	await assert.rejects(
		runCodexJob(
			{
				workspacesDir: path.join(root, 'workspaces'),
				codexBinary: fakeCodex,
				codexLiveSearch: false,
				codexReasoningEffort: 'medium',
				codexTimeoutMs: 10_000,
				codexIdeaTimeoutMs: 10_000,
			},
			{ id: 'failed-job', type: 'article', prompt: 'Bir yazı hazırla.', createdAt: new Date().toISOString() },
			{ recentArticles: [] },
		),
		(error) => {
			assert.match(error.message, /Configured model is unavailable\./);
			assert.doesNotMatch(error.message, /private candidate content/);

			return true;
		},
	);
});

test('Codex process diagnostics redact bearer and proxy credentials', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-redaction-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-secret-failure.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
process.stderr.write('Bearer super-secret-token via https://alice:proxy-pass@proxy.example.com failed');
process.exit(1);
`,
		{ mode: 0o755 },
	);

	await assert.rejects(
		runCodexJob(
			{
				workspacesDir: path.join(root, 'workspaces'),
				codexBinary: fakeCodex,
				codexLiveSearch: false,
				codexReasoningEffort: 'medium',
				codexTimeoutMs: 10_000,
				codexIdeaTimeoutMs: 10_000,
			},
			{ id: 'redacted-job', type: 'article', prompt: 'Bir yazı hazırla.', createdAt: new Date().toISOString() },
			{ recentArticles: [] },
		),
		(error) => {
			assert.match(error.message, /Bearer \[REDACTED\]/);
			assert.match(error.message, /https:\/\/\[REDACTED\]@proxy\.example\.com/);
			assert.doesNotMatch(error.message, /super-secret-token|alice|proxy-pass/);

			return true;
		},
	);
});

test('Codex completed turns recover from a non-zero CLI exit only when final JSON validates', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-completed-nonzero-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-completed-nonzero.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
const headings = Array.from({ length: 4 }, (_, index) => '<h2>Bölüm ' + index + '</h2>').join('');
const paragraphs = Array.from({ length: 10 }, () => '<p>' + 'Derin ve uygulamalı öğretici içerik. '.repeat(25) + '</p>').join('');
const result = { deliveryStatus: 'ready', blockingReason: '', title: 'Tamamlanan Geçerli Yazı', slug: 'tamamlanan-gecerli-yazi', description: 'Açıklama', content: headings + paragraphs, seoTitle: 'Geçerli Yazı', metaDescription: 'Geçerli yazı açıklaması.', tags: ['Ürün', 'Başlangıç', 'Rehber'], warnings: [], sources: [] };
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 30 } }) + '\\n');
process.exit(1);
`,
		{ mode: 0o755 },
	);

	const result = await runCodexJob(
		{
			workspacesDir: path.join(root, 'workspaces'),
			codexBinary: fakeCodex,
			codexLiveSearch: false,
			codexReasoningEffort: 'medium',
			codexTimeoutMs: 10_000,
			codexIdeaTimeoutMs: 10_000,
		},
		{ id: 'completed-job', type: 'article', prompt: 'Geçerli bir yazı hazırla.', createdAt: new Date().toISOString() },
		{ recentArticles: [] },
	);

	assert.equal(result.result.title, 'Tamamlanan Geçerli Yazı');
	assert.equal(result.usage.output_tokens, 30);
});

test('Codex non-zero recovery rejects a stream containing both completed and failed turns', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-mixed-terminal-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-mixed-terminal.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
const result = { deliveryStatus: 'ready', title: 'Stale candidate' };
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(result) } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.failed', error: { message: 'Failure after completion.' } }) + '\\n');
process.exit(1);
`,
		{ mode: 0o755 },
	);

	await assert.rejects(
		runCodexJob(
			{
				workspacesDir: path.join(root, 'workspaces'),
				codexBinary: fakeCodex,
				codexLiveSearch: false,
				codexReasoningEffort: 'medium',
				codexTimeoutMs: 10_000,
				codexIdeaTimeoutMs: 10_000,
			},
			{ id: 'mixed-job', type: 'article', prompt: 'Bir yazı hazırla.', createdAt: new Date().toISOString() },
			{ recentArticles: [] },
		),
		/Failure after completion\./,
	);
});

test('Codex non-zero recovery cannot reuse a stale structured output file', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-stale-output-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const workspacesDir = path.join(root, 'workspaces');
	const workspace = path.join(workspacesDir, 'stale-job');
	await mkdir(workspace, { recursive: true });
	await writeFile(
		path.join(workspace, 'article-result.json'),
		JSON.stringify({ deliveryStatus: 'ready', title: 'Önceki denemeden kalan sonuç' }),
	);
	const fakeCodex = path.join(root, 'fake-no-agent-message.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\\n');
process.exit(1);
`,
		{ mode: 0o755 },
	);

	await assert.rejects(
		runCodexJob(
			{
				workspacesDir,
				codexBinary: fakeCodex,
				codexLiveSearch: false,
				codexReasoningEffort: 'medium',
				codexTimeoutMs: 10_000,
				codexIdeaTimeoutMs: 10_000,
			},
			{ id: 'stale-job', type: 'article', prompt: 'Yeni bir yazı hazırla.', createdAt: new Date().toISOString() },
			{ recentArticles: [] },
		),
		/exited with code 1/,
	);
});

test('Codex non-zero recovery never accepts a signal-terminated process', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-signal-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-signal.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: {} }) + '\\n');
process.kill(process.pid, 'SIGTERM');
`,
		{ mode: 0o755 },
	);

	await assert.rejects(
		runCodexJob(
			{
				workspacesDir: path.join(root, 'workspaces'),
				codexBinary: fakeCodex,
				codexLiveSearch: false,
				codexReasoningEffort: 'medium',
				codexTimeoutMs: 10_000,
				codexIdeaTimeoutMs: 10_000,
			},
			{ id: 'signal-job', type: 'article', prompt: 'Bir yazı hazırla.', createdAt: new Date().toISOString() },
			{ recentArticles: [] },
		),
		/SIGTERM/,
	);
});

test('runCodexJob sends all editorial input over stdin without shell access', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-runner-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-codex.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const input = readFileSync(0, 'utf8');
writeFileSync('captured-input.txt', input);
writeFileSync('captured-args.json', JSON.stringify(process.argv.slice(2)));
const args = process.argv.slice(2);
const outputFile = args[args.indexOf('-o') + 1];
const headings = Array.from({ length: 4 }, (_, index) => '<h2>Bölüm ' + (index + 1) + '</h2>').join('');
const paragraphs = Array.from({ length: 10 }, () => '<p>' + 'Derin ve uygulamalı öğretici içerik burada açıklanır. '.repeat(20) + '</p>').join('');
const result = input.includes('Research current editorial opportunities')
  ? { theme: 'Ajanlar', researchSummary: 'Güncel araştırma.', options: Array.from({ length: 5 }, (_, index) => ({ title: 'Fikir ' + index, hook: 'Güçlü kanca ' + index, angle: 'Özgün açı ' + index, whyNow: 'Şimdi önemli ' + index, outline: ['Teori', 'Örnek', 'Uygulama'] })), sources: [{ title: 'Kaynak', url: 'https://example.com' }] }
  : { deliveryStatus: 'ready', blockingReason: '', title: 'Doğrulama Döngüleri Rehberi', slug: 'dogrulama-donguleri-rehberi', description: 'Uygulamalı rehber.', content: headings + paragraphs, seoTitle: 'Doğrulama Döngüleri', metaDescription: 'Doğrulama döngülerini öğrenin.', tags: ['Teknoloji', 'İleri Seviye', 'Rehber'], warnings: [], sources: [] };
writeFileSync(outputFile, JSON.stringify(result));
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } }) + '\\n');
`,
		{ mode: 0o755 },
	);

	const result = await runCodexJob(
		{
			workspacesDir: path.join(root, 'workspaces'),
			codexBinary: fakeCodex,
			codexLiveSearch: false,
			codexReasoningEffort: 'medium',
			codexTimeoutMs: 10_000,
			codexIdeaTimeoutMs: 10_000,
		},
		{
			id: 'job-test',
			type: 'article',
			prompt: 'Doğrulama döngülerini anlat.',
			createdAt: '2026-07-20T00:00:00.000Z',
		},
		{ recentArticles: [{ title: 'Önceki yazı' }] },
	);

	const workspace = path.join(root, 'workspaces', 'job-test');
	const input = await readFile(path.join(workspace, 'captured-input.txt'), 'utf8');
	const args = JSON.parse(await readFile(path.join(workspace, 'captured-args.json'), 'utf8'));
	assert.match(input, /Doğrulama döngülerini anlat/);
	assert.match(input, /Önceki yazı/);
	assert.equal(args.includes('read-only'), true);
	assert.equal(args.includes('--ask-for-approval'), true);
	assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
	assert.equal(args.includes('--ignore-user-config'), true);
	assert.equal(args.some((argument) => argument.startsWith('model=')), false);
	assert.equal(args.at(-1), '-');
	assert.equal(result.threadId, 'thread-test');
	assert.match(result.editorialMemoryVersion, /^[a-f0-9]{12}$/);

	await runCodexJob(
		{
			workspacesDir: path.join(root, 'workspaces'),
			codexBinary: fakeCodex,
			codexLiveSearch: true,
			codexReasoningEffort: 'high',
			codexRevisionReasoningEffort: 'medium',
			codexRevisionModel: 'gpt-5.6-terra',
			codexTimeoutMs: 10_000,
			codexRevisionTimeoutMs: 10_000,
			codexIdeaTimeoutMs: 10_000,
		},
		{
			id: 'job-test',
			type: 'article',
			prompt: 'Doğrulama döngülerini anlat.',
			createdAt: '2026-07-20T00:00:00.000Z',
			existingArticle: result.result,
			qualityReview: { verdict: 'revise', revisionInstructions: 'Bir gerçek hayat örneği ekle.' },
		},
		{ recentArticles: [] },
	);
	const revisionArgs = JSON.parse(await readFile(path.join(workspace, 'captured-args.json'), 'utf8'));
	const revisionInput = await readFile(path.join(workspace, 'captured-input.txt'), 'utf8');
	assert.equal(revisionArgs.includes('model="gpt-5.6-terra"'), true);
	assert.equal(revisionArgs.includes('model_reasoning_effort="medium"'), true);
	assert.equal(revisionArgs.includes('--search'), false);
	assert.doesNotMatch(revisionInput, /"readTime"/);
	assert.match(revisionInput, /cross-check every repeated quantity, identifier, entity, and state transition/);
});

test('runCodexJob forces xhigh reasoning and live search for idea research', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-ideas-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const sourceFixture = new URL(import.meta.url).pathname;
	const firstTestSource = await readFile(sourceFixture, 'utf8');
	const scriptMatch = [
		...firstTestSource.matchAll(/`#!\/usr\/bin\/env node\n([\s\S]*?)`,\n\s*\{ mode: 0o755 \}/g),
	].find((match) => match[1].includes('captured-input.txt'));
	assert.ok(scriptMatch);
	const fakeCodex = path.join(root, 'fake-codex.mjs');
	await writeFile(fakeCodex, `#!/usr/bin/env node\n${scriptMatch[1]}`, { mode: 0o755 });

	const result = await runCodexJob(
		{
			workspacesDir: path.join(root, 'workspaces'),
			codexBinary: fakeCodex,
			codexLiveSearch: false,
			codexReasoningEffort: 'medium',
			codexTimeoutMs: 10_000,
			codexIdeaTimeoutMs: 10_000,
		},
		{ id: 'idea-test', type: 'ideas', prompt: 'Ajanlar', createdAt: '2026-07-20T00:00:00.000Z' },
		{ recentArticles: [] },
	);
	const workspace = path.join(root, 'workspaces', 'idea-test');
	const args = JSON.parse(await readFile(path.join(workspace, 'captured-args.json'), 'utf8'));
	assert.equal(args.includes('model_reasoning_effort="xhigh"'), true);
	assert.equal(args.includes('--search'), true);
	assert.equal(result.result.options.length, 5);
});

test('runCodexReview uses the account default in an isolated process without search or application secrets', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-review-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const previousToken = process.env.DIRECTUS_TOKEN;
	process.env.DIRECTUS_TOKEN = 'must-not-reach-reviewer';
	context.after(() => {
		if (previousToken === undefined) delete process.env.DIRECTUS_TOKEN;
		else process.env.DIRECTUS_TOKEN = previousToken;
	});
	const fakeCodex = path.join(root, 'fake-reviewer.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const input = readFileSync(0, 'utf8');
const args = process.argv.slice(2);
writeFileSync('review-input.txt', input);
writeFileSync('review-args.json', JSON.stringify(args));
writeFileSync('review-env.json', JSON.stringify({ directus: process.env.DIRECTUS_TOKEN || null }));
const outputFile = args[args.indexOf('-o') + 1];
writeFileSync(outputFile, JSON.stringify({ verdict: 'pass', summary: 'Yayın standardını karşılıyor.', issues: [], revisionInstructions: '' }));
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'review-thread' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 30, output_tokens: 10 } }) + '\\n');
`,
		{ mode: 0o755 },
	);
	const workspace = path.join(root, 'workspaces', 'review-job');
	const result = await runCodexReview(
		{
			workspacesDir: path.join(root, 'workspaces'),
			codexBinary: fakeCodex,
			codexReviewModel: null,
			codexReviewReasoningEffort: 'medium',
			codexReviewTimeoutMs: 10_000,
		},
		{ id: 'review-job', prompt: 'Derin bir yazı hazırla.' },
		{
			title: 'Aday',
			content: '<p>İçerik</p>',
			readTime: 7,
			seoTitle: 'Aday SEO başlığı',
			tags: ['Teknoloji', 'İleri Seviye', 'Rehber'],
			sources: [{ title: 'Kaynak', url: 'https://example.com/source' }],
		},
		{ recentArticles: [] },
	);
	const args = JSON.parse(await readFile(path.join(workspace, 'review-args.json'), 'utf8'));
	const input = await readFile(path.join(workspace, 'review-input.txt'), 'utf8');
	const childEnvironment = JSON.parse(await readFile(path.join(workspace, 'review-env.json'), 'utf8'));

	assert.equal(args.some((argument) => argument.startsWith('model=')), false);
	assert.equal(args.includes('model_reasoning_effort="medium"'), true);
	assert.equal(args.includes('--search'), false);
	assert.equal(args.includes('read-only'), true);
	assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
	assert.match(input, /Static editorial memory/);
	assert.doesNotMatch(input, /"readTime"/);
	assert.match(input, /"seoTitle":"Aday SEO başlığı"/);
	assert.match(input, /"tags":\["Teknoloji","İleri Seviye","Rehber"\]/);
	assert.match(input, /https:\/\/example\.com\/source/);
	assert.match(input, /reading time is intentionally excluded/);
	assert.equal(childEnvironment.directus, null);
	assert.equal(result.result.verdict, 'pass');
	assert.equal(result.threadId, 'review-thread');
});

test('runCodexLearning is isolated, records its role and returns at most one validated proposal', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-learning-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const previousToken = process.env.DIRECTUS_TOKEN;
	process.env.DIRECTUS_TOKEN = 'must-not-reach-learning';
	context.after(() => {
		if (previousToken === undefined) delete process.env.DIRECTUS_TOKEN;
		else process.env.DIRECTUS_TOKEN = previousToken;
	});
	const fakeCodex = path.join(root, 'fake-learning.mjs');
	await writeFile(
		fakeCodex,
		`#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const input = readFileSync(0, 'utf8');
const args = process.argv.slice(2);
writeFileSync('learning-input.txt', input);
writeFileSync('learning-args.json', JSON.stringify(args));
writeFileSync('learning-env.json', JSON.stringify({ directus: process.env.DIRECTUS_TOKEN || null }));
const outputFile = args[args.indexOf('-o') + 1];
writeFileSync(outputFile, JSON.stringify({ outcome: 'proposal', reason: 'Tekrarlanan açık tercih.', proposal: { text: 'Her ana örneği doldurulmuş verilerle göster.', rationale: 'Edit talimatı bunu gerektirdi.', evidence: ['edit-1'] } }));
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'learning-thread' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 40, output_tokens: 12 } }) + '\\n');
`,
		{ mode: 0o755 },
	);
	const executions = [];
	const result = await runCodexLearning(
		{
			workspacesDir: path.join(root, 'workspaces'),
			codexBinary: fakeCodex,
			codexLearningModel: null,
			codexLearningReasoningEffort: 'medium',
			codexLearningTimeoutMs: 10_000,
		},
		{ id: 'publication-job' },
		{ revisionChain: [{ explicitEditInstruction: 'Örnekleri doldur.' }], finalArticle: { title: 'Yazı' } },
		{ onExecution: (execution) => executions.push(execution) },
	);
	const workspace = path.join(root, 'workspaces', 'publication-job', 'learning');
	const args = JSON.parse(await readFile(path.join(workspace, 'learning-args.json'), 'utf8'));
	const childEnvironment = JSON.parse(await readFile(path.join(workspace, 'learning-env.json'), 'utf8'));
	assert.equal(args.includes('--search'), false);
	assert.equal(args.some((argument) => argument.startsWith('model=')), false);
	assert.equal(args.includes('read-only'), true);
	assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
	assert.equal(childEnvironment.directus, null);
	assert.equal(result.result.outcome, 'proposal');
	assert.deepEqual(executions.map((execution) => execution.status), ['running', 'completed']);
	assert.equal(executions[0].role, 'learning');
});

test('runCodexJob aborts cooperatively and reports an interrupted execution', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'codex-abort-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const fakeCodex = path.join(root, 'fake-slow.mjs');
	await writeFile(fakeCodex, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o755 });
	const controller = new AbortController();
	const executions = [];
	setTimeout(() => controller.abort(), 100).unref();
	await assert.rejects(
		runCodexJob(
			{
				workspacesDir: path.join(root, 'workspaces'),
				codexBinary: fakeCodex,
				codexLiveSearch: false,
				codexReasoningEffort: 'medium',
				codexTimeoutMs: 10_000,
				codexIdeaTimeoutMs: 10_000,
			},
			{ id: 'abort-job', type: 'article', prompt: 'Uzun bir yazı hazırla.', createdAt: new Date().toISOString() },
			{ recentArticles: [] },
			{ signal: controller.signal, onExecution: (execution) => executions.push(execution) },
		),
		(error) => error.name === 'AbortError',
	);
	assert.deepEqual(executions.map((execution) => execution.status), ['running', 'interrupted']);
});

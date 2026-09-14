import assert from 'node:assert/strict';
import test from 'node:test';

import { formatJobStatus, isOwnedBy, resolveJobStatus } from '../src/job-status.mjs';

const job = {
	id: 'bb549ac3-1710-4e7e-930b-76cac45c7685',
	type: 'article',
	status: 'running',
	attempts: 1,
	createdAt: '2026-07-21T10:00:00.000Z',
	startedAt: '2026-07-21T10:01:00.000Z',
	completedAt: null,
	telegramChatId: '10',
	telegramUserId: '20',
	progress: { stage: 'generating', message: 'Codex yazıyı hazırlıyor ve doğruluyor.' },
};

test('status output includes progress and elapsed time', () => {
	const message = formatJobStatus(job, { now: new Date('2026-07-21T10:13:30.000Z') });

	assert.match(message, /Durum: Çalışıyor/);
	assert.match(message, /Aşama: Codex yazıyı hazırlıyor ve doğruluyor\./);
	assert.match(message, /Geçen süre: 12 dk/);
});

test('status ownership requires both Telegram user and chat', () => {
	assert.equal(isOwnedBy(job, '10', '20'), true);
	assert.equal(isOwnedBy(job, '10', '21'), false);
	assert.equal(isOwnedBy(job, '11', '20'), false);
	assert.equal(isOwnedBy(null, '10', '20'), false);
});

test('published article status prefers its public URL over the preview', () => {
	const message = formatJobStatus({
		...job,
		status: 'completed',
		completedAt: '2026-07-21T10:13:00.000Z',
		result: {
			title: 'Doğrulama Döngüleri',
			previewUrl: 'https://blog.example.com/preview/secret',
			publishedUrl: 'https://blog.example.com/blog/dogrulama-donguleri',
		},
	});

	assert.match(message, /Yayın: https:\/\/blog\.example\.com\/blog\/dogrulama-donguleri/);
	assert.doesNotMatch(message, /preview\/secret/);
});

test('completed idea status includes bounded options and a ready selection command', () => {
	const ideaJob = {
		...job,
		id: '4cc77fe7-3ecb-4626-a16d-1712a0d93726',
		type: 'ideas',
		status: 'completed',
		completedAt: '2026-07-21T10:13:00.000Z',
		result: {
			kind: 'ideas',
			theme: 'Yapay zekâda güncel tartışmalar',
			researchSummary: 'Güncel tartışmalar maliyet, denetim ve ajan araçları etrafında yoğunlaşıyor.',
			options: [
				{ title: 'Ucuz Token, Pahalı İş', hook: 'Kabul edilen sonuç üzerinden gerçek maliyet nasıl ölçülür?' },
				{ title: 'İnceleme Kuyruğu', hook: 'Üretim artarken insan denetimi neden darboğaza dönüşür?' },
			],
		},
	};
	const message = formatJobStatus(ideaJob);

	assert.match(message, /1\. Ucuz Token, Pahalı İş/);
	assert.match(message, /2\. İnceleme Kuyruğu/);
	assert.match(message, new RegExp(`/sec ${ideaJob.id} <seçenek-no>$`));
	assert.ok(message.length <= 4096);
});

test('status resolver enforces ownership without creating another job', async () => {
	let queuePositionCalls = 0;
	const store = {
		async get(id) {
			return id === job.id ? job : null;
		},
		async queuePosition() {
			queuePositionCalls += 1;

			return null;
		},
		async list() {
			return [job];
		},
	};
	const owned = await resolveJobStatus(store, {
		targetJobId: job.id,
		telegramChatId: '10',
		telegramUserId: '20',
	});
	const foreign = await resolveJobStatus(store, {
		targetJobId: job.id,
		telegramChatId: '10',
		telegramUserId: '999',
	});

	assert.equal(owned.found, true);
	assert.match(owned.message, /Durum: Çalışıyor/);
	assert.equal(foreign.found, false);
	assert.equal(queuePositionCalls, 1);
});

test('status resolver follows completed edits to the latest published revision', async () => {
	const original = {
		...job,
		status: 'completed',
		completedAt: '2026-07-21T10:04:00.000Z',
		result: {
			title: 'İçerik kapsamı alınamadı',
			postId: 'directus-post-1',
			previewUrl: 'https://blog.example.com/preview/old-secret',
		},
	};
	const revision = {
		...job,
		id: '86cafa01-c86d-4930-bd03-4197624063e9',
		type: 'edit',
		status: 'completed',
		createdAt: '2026-07-21T11:00:00.000Z',
		startedAt: '2026-07-21T11:00:10.000Z',
		completedAt: '2026-07-21T11:02:00.000Z',
		result: {
			// Legacy edit records may not carry the explicit parent link; the Directus post still identifies the revision family.
			postId: 'directus-post-1',
			title: 'Yapay Zekâ Ajanlarında Doğrulama Döngüsü',
			previewUrl: 'https://blog.example.com/preview/current-secret',
			publishedUrl: 'https://blog.example.com/blog/dogrulama-dongusu',
		},
	};
	const store = {
		async get(id) {
			return id === original.id ? original : null;
		},
		async list() {
			return [original, revision];
		},
		async queuePosition() {
			return null;
		},
	};

	const result = await resolveJobStatus(store, {
		targetJobId: original.id,
		telegramChatId: original.telegramChatId,
		telegramUserId: original.telegramUserId,
	});

	assert.equal(result.job.id, revision.id);
	assert.match(result.message, new RegExp(`Sorgulanan iş: ${original.id}`));
	assert.match(result.message, new RegExp(`Güncel revizyon: ${revision.id}`));
	assert.match(result.message, /Sonuç: Yapay Zekâ Ajanlarında Doğrulama Döngüsü/);
	assert.match(result.message, /Yayın: https:\/\/blog\.example\.com\/blog\/dogrulama-dongusu/);
	assert.doesNotMatch(result.message, /İçerik kapsamı alınamadı|old-secret|current-secret/);
});

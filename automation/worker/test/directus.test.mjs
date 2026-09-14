import assert from 'node:assert/strict';
import test from 'node:test';

import { getDefaultContentProfile } from '../src/content-profile.mjs';
import { createDirectusDraft, getDirectusDraftForEdit, publishDirectusPost, updateDirectusDraft } from '../src/directus.mjs';

const config = {
	directusUrl: 'https://cms.example.com',
	directusToken: 'test-token',
	siteUrl: 'https://blog.example.com',
	previewSecret: 'preview-secret',
};

function jsonResponse(data, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => ({ data }),
	};
}

test('Directus edit loading accepts only an actual draft', async (context) => {
	const originalFetch = globalThis.fetch;
	context.after(() => {
		globalThis.fetch = originalFetch;
	});
	globalThis.fetch = async () =>
		jsonResponse({ id: 'post-1', slug: 'ornek', title: 'Örnek', status: 'archived', content: '<p>x</p>' });

	await assert.rejects(() => getDirectusDraftForEdit(config, 'post-1'), /Yalnız draft durumundaki yazılar/);
});

test('Directus draft update rechecks state immediately before writing', async (context) => {
	const originalFetch = globalThis.fetch;
	context.after(() => {
		globalThis.fetch = originalFetch;
	});
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return jsonResponse({ id: 'post-1', slug: 'ornek', status: 'published' });
	};

	await assert.rejects(
		() =>
			updateDirectusDraft(config, 'post-1', 'ornek', {
				title: 'Başlık',
				description: 'Açıklama',
				content: '<p>İçerik</p>',
				readTime: 2,
				seoTitle: 'SEO',
				metaDescription: 'Meta',
				tags: [],
			}),
		/Taslak artık düzenlenebilir durumda değil/,
	);
	assert.equal(calls, 1);
});

test('Directus publish rejects unrelated states and is idempotent for an already published post', async (context) => {
	const originalFetch = globalThis.fetch;
	context.after(() => {
		globalThis.fetch = originalFetch;
	});
	let currentStatus = 'archived';
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return jsonResponse({
			id: 'post-1',
			title: 'Başlık',
			slug: 'ornek',
			status: currentStatus,
			published_at: '2026-07-21T12:00:00.000Z',
		});
	};

	await assert.rejects(() => publishDirectusPost(config, 'post-1'), /Yalnız draft durumundaki yazılar/);
	currentStatus = 'published';
	const published = await publishDirectusPost(config, 'post-1');
	assert.equal(published.slug, 'ornek');
	assert.equal(calls, 2);
});

test('Directus draft creation follows the project collection, field map and preview route', async (context) => {
	const originalFetch = globalThis.fetch;
	context.after(() => {
		globalThis.fetch = originalFetch;
	});
	const baseProfile = getDefaultContentProfile();
	const contentProfile = {
		...baseProfile,
		routes: { ...baseProfile.routes, previewPost: '/preview/stories' },
		cms: {
			...baseProfile.cms,
			collection: 'articles',
			fields: { ...baseProfile.cms.fields, content: 'body', readTime: 'reading_minutes' },
		},
	};
	const requests = [];
	globalThis.fetch = async (url, options = {}) => {
		requests.push({ url: String(url), options });
		if (options.method === 'POST') {
			return jsonResponse({ id: 'article-1', slug: 'ornek', title: 'Örnek', status: 'draft' });
		}
		return jsonResponse([]);
	};

	const draft = await createDirectusDraft(
		{ ...config, contentProfile },
		{
			title: 'Örnek',
			slug: 'ornek',
			description: 'Açıklama',
			content: '<p>İçerik</p>',
			readTime: 3,
			seoTitle: 'SEO',
			metaDescription: 'Meta',
			tags: ['Ürün', 'Başlangıç', 'Rehber'],
		},
	);

	assert.match(requests[0].url, /\/items\/articles\?/);
	assert.match(requests[1].url, /\/items\/articles$/);
	const payload = JSON.parse(requests[1].options.body);
	assert.equal(payload.body, '<p>İçerik</p>');
	assert.equal(payload.reading_minutes, 3);
	assert.equal(payload.content, undefined);
	assert.equal(draft.previewUrl, 'https://blog.example.com/preview/stories/ornek?token=preview-secret');
});

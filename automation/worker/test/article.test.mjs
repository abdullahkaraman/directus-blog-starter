import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { calculateReadTime, sanitizeArticleHtml, slugify, validateArticle } from '../src/article.mjs';
import { getDefaultContentProfile } from '../src/content-profile.mjs';

const validContent = `${Array.from({ length: 4 }, (_, index) => `<h2>Bölüm ${index + 1}</h2>`).join('')}${Array.from(
	{ length: 10 },
	() => `<p>${'Bu içerik gerçek bir öğretici paragraftır. '.repeat(20)}</p>`,
).join('')}`;

function makeValidArticle(overrides = {}) {
	return {
		deliveryStatus: 'ready',
		blockingReason: '',
		title: 'Yazılım Kariyerinde Sağlam Bir Yol Haritası',
		slug: '',
		description: 'Uygulamalı bir rehber.',
		content: validContent,
		seoTitle: 'Yazılım Kariyeri Rehberi',
		metaDescription: 'Yazılım kariyerinizi bilinçli adımlarla geliştirin.',
		tags: ['İşletme', 'Başlangıç', 'Rehber'],
		warnings: [],
		sources: [{ title: 'Kaynak', url: 'https://example.com' }],
		...overrides,
	};
}

test('article output schema uses only supported array constraints', async () => {
	const schema = JSON.parse(
		await readFile(new URL('../templates/article-result.schema.json', import.meta.url), 'utf8'),
	);

	assert.equal(schema.properties.tags.minItems, 3);
	assert.equal(schema.properties.tags.maxItems, 3);
	assert.equal(schema.properties.tags.uniqueItems, undefined);
});

test('slugify handles Turkish characters', () => {
	assert.equal(slugify('Yapay Zekânın İşini Doğrula!'), 'yapay-zekanin-isini-dogrula');
});

test('sanitizeArticleHtml removes scripts and unsafe links', () => {
	const html = sanitizeArticleHtml(
		'<p>Merhaba</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://example.com">kaynak</a>',
	);
	assert.equal(html.includes('<script'), false);
	assert.equal(html.includes('javascript:'), false);
	assert.match(html, /href="https:\/\/example\.com" rel="noopener noreferrer" target="_blank"/);
});

test('calculateReadTime uses 225 words per minute', () => {
	assert.equal(calculateReadTime(`<p>${'kelime '.repeat(226)}</p>`), 2);
});

test('validateArticle normalizes a valid model result', () => {
	const article = validateArticle(
		makeValidArticle({
			title: 'Kendi Yapay Zekâ Sisteminizi Kurun',
			seoTitle: 'Yapay Zekâ Sistemi Kurma Rehberi',
			metaDescription: 'Kendi sisteminizi adım adım kurun.',
			tags: ['Teknoloji', 'Başlangıç', 'Rehber'],
		}),
	);

	assert.equal(article.slug, 'kendi-yapay-zeka-sisteminizi-kurun');
	assert.deepEqual(article.tags, ['Teknoloji', 'Başlangıç', 'Rehber']);
});

test('validateArticle keeps normalized subject-specific tags without adding an AI tag', () => {
	const article = validateArticle(
		makeValidArticle({
			tags: ['  İşletme  ', '<strong>Başlangıç</strong>', 'Rehber'],
		}),
	);

	assert.deepEqual(article.tags, ['İşletme', 'Başlangıç', 'Rehber']);
	assert.equal(article.tags.includes('Teknoloji'), false);
});

const invalidTagCases = [
	{ name: 'missing tags', tags: undefined, error: /must include exactly 3 distinct tags/ },
	{ name: 'an empty tag list', tags: [], error: /must include exactly 3 distinct tags/ },
	{ name: 'a single tag', tags: ['İşletme'], error: /must include exactly 3 distinct tags/ },
	{ name: 'an empty tag', tags: ['', 'Kültür', 'Rehber'], error: /must be non-empty strings/ },
	{
		name: 'an unsupported topic label',
		tags: ['Güvenlik', 'Başlangıç', 'Rehber'],
		error: /must use the supported editorial taxonomy/,
	},
	{ name: 'duplicate tags', tags: ['İşletme', ' işletme ', 'Rehber'], error: /must be distinct/ },
	{
		name: 'more than three tags',
		tags: ['İşletme', 'Başlangıç', 'Analiz', 'Rehber'],
		error: /must include exactly 3 distinct tags/,
	},
	{ name: 'a missing reader level', tags: ['Teknoloji', 'Rehber', 'Analiz'], error: /exactly one reader-level tag/ },
	{ name: 'a missing approach', tags: ['Teknoloji', 'Başlangıç', 'İleri Seviye'], error: /exactly one approach tag/ },
	{ name: 'two topic tags', tags: ['Teknoloji', 'Ürün', 'Rehber'], error: /exactly one topic tag/ },
	{
		name: 'two reader levels',
		tags: ['Teknoloji', 'Başlangıç', 'İleri Seviye'],
		error: /exactly one reader-level tag/,
	},
];

test('validateArticle accepts exactly one tag from each taxonomy dimension', () => {
	const article = validateArticle(makeValidArticle({ tags: ['Teknoloji', 'Orta Seviye', 'Analiz'] }));

	assert.deepEqual(article.tags, ['Teknoloji', 'Orta Seviye', 'Analiz']);
});

test('validateArticle follows the project taxonomy and reading-speed profile', () => {
	const base = getDefaultContentProfile();
	const profile = {
		...base,
		article: {
			validation: { ...base.article.validation, wordsPerMinute: 100 },
			taxonomy: {
				topic: ['Food'],
				level: ['Local'],
				approach: ['Review'],
			},
		},
	};
	const article = validateArticle(makeValidArticle({ tags: ['Food', 'Local', 'Review'] }), profile);

	assert.deepEqual(article.tags, ['Food', 'Local', 'Review']);
	assert.ok(article.readTime > calculateReadTime(article.content));
});

for (const { name, tags, error } of invalidTagCases) {
	test(`validateArticle rejects ${name} instead of applying a default AI tag`, () => {
		assert.throws(() => validateArticle(makeValidArticle({ tags })), error);
	});
}

test('validateArticle rejects shallow short results', () => {
	assert.throws(
		() =>
			validateArticle({
				deliveryStatus: 'ready',
				blockingReason: '',
				title: 'Kısa Yapay Zekâ Yazısı',
				content: `<p>${'Kısa içerik. '.repeat(100)}</p>`,
			}),
		/Generated article is too short \(200\/1000 words\)/,
	);
});

test('validateArticle rejects blocked operational output', () => {
	assert.throws(
		() => validateArticle({ deliveryStatus: 'blocked', blockingReason: 'job.json okunamadı.' }),
		/Codex could not deliver an article/,
	);
});

test('validateArticle rejects code templates with empty placeholder fields', () => {
	const template = `<pre><code>GÖREV:\n-\nBAŞARI KOŞULLARI:\n-\nYASAK EYLEMLER:\n-</code></pre>`;
	const body = `${Array.from({ length: 4 }, (_, index) => `<h2>Bölüm ${index + 1}</h2>`).join('')}${Array.from({ length: 10 }, () => `<p>${'Bu içerik gerçek bir öğretici paragraftır. '.repeat(20)}</p>`).join('')}${template}`;

	assert.throws(
		() =>
			validateArticle({
				deliveryStatus: 'ready',
				blockingReason: '',
				title: 'Doğrulama Sözleşmesi Hazırlama Rehberi',
				content: body,
			}),
		/Generated article contains an unfilled example template/,
	);
});

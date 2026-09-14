import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getDefaultContentProfile, loadContentProfile } from '../src/content-profile.mjs';

const templates = {
	articleInstructions: 'article.md',
	ideaInstructions: 'ideas.md',
	editorialContext: 'context.md',
	editorialMemory: 'memory.md',
	qualityReview: 'review.md',
	learning: 'learning.md',
	articleSchema: 'article.json',
	ideaSchema: 'ideas.json',
	qualityReviewSchema: 'review.json',
	learningSchema: 'learning.json',
};

function profile(overrides = {}) {
	return {
		id: 'example',
		pipeline: 'article',
		publication: {
			name: 'Example',
			assistantName: 'Example assistant',
			language: 'tr',
			authorVoice: 'clear and practical',
		},
		ideas: { defaultPrompt: 'Yeni fikirler araştır.', selectionPrompt: 'Seçilen fikri yazıya dönüştür.' },
		article: {
			validation: { minimumWords: 500, minimumHeadings: 3, minimumParagraphs: 5, wordsPerMinute: 200 },
			taxonomy: {
				topic: ['Technology', 'Business'],
				level: ['Beginner', 'Advanced'],
				approach: ['Guide', 'Analysis'],
			},
		},
		routes: { publicPost: '/stories', previewPost: '/preview/stories' },
		cms: {
			collection: 'articles',
			recentLimit: 8,
			statuses: { draft: 'draft', published: 'published' },
			fields: {
				id: 'id',
				title: 'title',
				slug: 'slug',
				description: 'description',
				content: 'body',
				readTime: 'read_time',
				status: 'status',
				publishedAt: 'published_at',
				seo: 'seo',
			},
			seoFields: {
				title: 'title',
				metaDescription: 'meta_description',
				additional: 'additional_fields',
				tags: 'tags',
			},
		},
		templates,
		...overrides,
	};
}

async function writeProfile(root, value) {
	await mkdir(root, { recursive: true });
	await writeFile(path.join(root, 'profile.json'), `${JSON.stringify(value, null, 2)}\n`);
}

test('default content profile matches the public starter contract', () => {
	const result = getDefaultContentProfile();
	assert.equal(result.id, 'default');
	assert.equal(result.pipeline, 'article');
	assert.equal(result.cms.collection, 'posts');
	assert.equal(result.routes.publicPost, '/blog');
	assert.equal(result.routes.previewPost, '/preview/blog');
});

test('public starter profile excludes the private reference publication identity', async () => {
	const result = getDefaultContentProfile();
	const files = [path.join(result.rootDir, 'profile.json'), ...Object.values(result.templates)];
	const content = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

	assert.doesNotMatch(content, /İyiBlog|İyi Blog|İyi Girişim|Daimon|iyiblog|iyigirisim/i);
});

test('content profiles can replace publication, routes and Directus field mapping', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'content-profile-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await writeProfile(root, profile());

	const result = loadContentProfile(root);
	assert.equal(result.publication.name, 'Example');
	assert.equal(result.cms.collection, 'articles');
	assert.equal(result.cms.fields.content, 'body');
	assert.equal(result.templates.articleInstructions, path.join(root, 'article.md'));
});

test('content profiles reject unsafe collection, route and template paths', async (context) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'content-profile-invalid-'));
	context.after(() => rm(root, { recursive: true, force: true }));

	await writeProfile(root, profile({ routes: { publicPost: 'https://evil.example', previewPost: '/preview' } }));
	assert.throws(() => loadContentProfile(root), /absolute site path/);

	await writeProfile(root, profile({ cms: { ...profile().cms, collection: '../posts' } }));
	assert.throws(() => loadContentProfile(root), /safe Directus collection/);

	await writeProfile(root, profile({ templates: { ...templates, articleInstructions: '../private.md' } }));
	assert.throws(() => loadContentProfile(root), /must stay inside/);
});

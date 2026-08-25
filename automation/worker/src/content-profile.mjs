import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROFILE_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const REQUIRED_FIELDS = [
	'id',
	'title',
	'slug',
	'description',
	'content',
	'readTime',
	'status',
	'publishedAt',
	'seo',
];
const REQUIRED_SEO_FIELDS = ['title', 'metaDescription', 'additional', 'tags'];
const REQUIRED_TEMPLATES = [
	'articleInstructions',
	'ideaInstructions',
	'editorialContext',
	'editorialMemory',
	'qualityReview',
	'learning',
	'articleSchema',
	'ideaSchema',
	'qualityReviewSchema',
	'learningSchema',
];

let defaultProfile;

function plainObject(value, name) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
	return value;
}

function requiredText(value, name, maxLength = 200) {
	const normalized = String(value || '').trim();
	if (!normalized) throw new Error(`${name} is required.`);
	if (normalized.length > maxLength) throw new Error(`${name} is too long.`);
	return normalized;
}

function route(value, name) {
	const normalized = requiredText(value, name).replace(/\/$/, '') || '/';
	if (!normalized.startsWith('/') || normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) {
		throw new Error(`${name} must be an absolute site path.`);
	}
	return normalized;
}

function fieldMap(value, required, name) {
	const input = plainObject(value, name);
	return Object.fromEntries(
		required.map((key) => {
			const field = requiredText(input[key], `${name}.${key}`, 64);
			if (!FIELD_NAME.test(field)) throw new Error(`${name}.${key} is not a safe Directus field name.`);
			return [key, field];
		}),
	);
}

function templateMap(value, rootDir) {
	const input = plainObject(value, 'templates');
	return Object.fromEntries(
		REQUIRED_TEMPLATES.map((key) => {
			const relative = requiredText(input[key], `templates.${key}`, 160);
			const resolved = path.resolve(rootDir, relative);
			const relativeToRoot = path.relative(rootDir, resolved);
			if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
				throw new Error(`templates.${key} must stay inside the content profile directory.`);
			}
			return [key, resolved];
		}),
	);
}

function positiveInteger(value, name, { minimum = 1, maximum = 100_000 } = {}) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
	}
	return parsed;
}

function taxonomyValues(value, name) {
	if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
		throw new Error(`${name} must contain between 1 and 100 labels.`);
	}
	const labels = value.map((label, index) => requiredText(label, `${name}[${index}]`, 40));
	const normalized = labels.map((label) => label.normalize('NFKC').toLocaleLowerCase('tr-TR'));
	if (new Set(normalized).size !== labels.length) throw new Error(`${name} labels must be distinct.`);
	return Object.freeze(labels);
}

export function loadContentProfile(profileDir = DEFAULT_PROFILE_DIR) {
	const rootDir = path.resolve(profileDir);
	let raw;
	try {
		raw = JSON.parse(readFileSync(path.join(rootDir, 'profile.json'), 'utf8'));
	} catch (error) {
		throw new Error(
			`Content profile could not be loaded from ${rootDir}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const input = plainObject(raw, 'content profile');
	const id = requiredText(input.id, 'profile.id', 64);
	if (!IDENTIFIER.test(id)) throw new Error('profile.id contains unsupported characters.');
	if (input.pipeline !== 'article') throw new Error('profile.pipeline must currently be article.');
	const publication = plainObject(input.publication, 'publication');
	const ideas = plainObject(input.ideas, 'ideas');
	const article = plainObject(input.article, 'article');
	const articleValidation = plainObject(article.validation, 'article.validation');
	const taxonomy = plainObject(article.taxonomy, 'article.taxonomy');
	const routes = plainObject(input.routes, 'routes');
	const cms = plainObject(input.cms, 'cms');
	const statuses = plainObject(cms.statuses, 'cms.statuses');
	const collection = requiredText(cms.collection, 'cms.collection', 64);
	if (!FIELD_NAME.test(collection)) throw new Error('cms.collection is not a safe Directus collection name.');
	const recentLimit = Number(cms.recentLimit);
	if (!Number.isSafeInteger(recentLimit) || recentLimit < 1 || recentLimit > 100) {
		throw new Error('cms.recentLimit must be an integer between 1 and 100.');
	}

	return Object.freeze({
		id,
		pipeline: input.pipeline,
		rootDir,
		publication: Object.freeze({
			name: requiredText(publication.name, 'publication.name'),
			assistantName: requiredText(publication.assistantName, 'publication.assistantName'),
			language: requiredText(publication.language, 'publication.language', 20),
			authorVoice: requiredText(publication.authorVoice, 'publication.authorVoice', 300),
		}),
		ideas: Object.freeze({
			defaultPrompt: requiredText(ideas.defaultPrompt, 'ideas.defaultPrompt', 1_000),
			selectionPrompt: requiredText(ideas.selectionPrompt, 'ideas.selectionPrompt', 1_000),
		}),
		article: Object.freeze({
			validation: Object.freeze({
				minimumWords: positiveInteger(articleValidation.minimumWords, 'article.validation.minimumWords'),
				minimumHeadings: positiveInteger(articleValidation.minimumHeadings, 'article.validation.minimumHeadings'),
				minimumParagraphs: positiveInteger(articleValidation.minimumParagraphs, 'article.validation.minimumParagraphs'),
				wordsPerMinute: positiveInteger(articleValidation.wordsPerMinute, 'article.validation.wordsPerMinute'),
			}),
			taxonomy: Object.freeze({
				topic: taxonomyValues(taxonomy.topic, 'article.taxonomy.topic'),
				level: taxonomyValues(taxonomy.level, 'article.taxonomy.level'),
				approach: taxonomyValues(taxonomy.approach, 'article.taxonomy.approach'),
			}),
		}),
		routes: Object.freeze({
			publicPost: route(routes.publicPost, 'routes.publicPost'),
			previewPost: route(routes.previewPost, 'routes.previewPost'),
		}),
		cms: Object.freeze({
			collection,
			recentLimit,
			statuses: Object.freeze({
				draft: requiredText(statuses.draft, 'cms.statuses.draft', 64),
				published: requiredText(statuses.published, 'cms.statuses.published', 64),
			}),
			fields: Object.freeze(fieldMap(cms.fields, REQUIRED_FIELDS, 'cms.fields')),
			seoFields: Object.freeze(fieldMap(cms.seoFields, REQUIRED_SEO_FIELDS, 'cms.seoFields')),
		}),
		templates: Object.freeze(templateMap(input.templates, rootDir)),
	});
}

export function getDefaultContentProfile() {
	defaultProfile ||= loadContentProfile();
	return defaultProfile;
}

export function contentProfileFor(config = {}) {
	return config.contentProfile || getDefaultContentProfile();
}

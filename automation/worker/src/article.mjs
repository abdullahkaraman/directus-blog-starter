import sanitizeHtml from 'sanitize-html';

import { getDefaultContentProfile } from './content-profile.mjs';

const ALLOWED_TAGS = [
	'p',
	'br',
	'strong',
	'em',
	'blockquote',
	'h2',
	'h3',
	'ul',
	'ol',
	'li',
	'pre',
	'code',
	'a',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
];

export function slugify(value) {
	return value
		.toLocaleLowerCase('tr-TR')
		.replaceAll('ı', 'i')
		.replaceAll('ğ', 'g')
		.replaceAll('ü', 'u')
		.replaceAll('ş', 's')
		.replaceAll('ö', 'o')
		.replaceAll('ç', 'c')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
}

export function stripHtml(value) {
	return sanitizeHtml(value || '', { allowedTags: [], allowedAttributes: {} })
		.replace(/\s+/g, ' ')
		.trim();
}

export function sanitizeArticleHtml(value) {
	return sanitizeHtml(value || '', {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: {
			a: ['href', 'rel', 'target'],
			th: ['colspan', 'rowspan'],
			td: ['colspan', 'rowspan'],
		},
		allowedSchemes: ['http', 'https', 'mailto'],
		transformTags: {
			a: (_tagName, attributes) => {
				const href = attributes.href || '#';
				const external = /^https?:\/\//i.test(href);

				return {
					tagName: 'a',
					attribs: {
						href,
						...(external ? { rel: 'noopener noreferrer', target: '_blank' } : {}),
					},
				};
			},
		},
	});
}

export function calculateReadTime(content, wordsPerMinute = 225) {
	const words = stripHtml(content).split(/\s+/).filter(Boolean).length;

	return Math.ceil(words / wordsPerMinute) || 1;
}

function hasUnfilledTemplate(content) {
	const codeBlocks = [...content.matchAll(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi)];

	return codeBlocks.some((match) => {
		const lines = sanitizeHtml(match[1], { allowedTags: [], allowedAttributes: {} })
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const blankLines = lines.filter((line) => /^[-–—•]\s*$/.test(line)).length;
		const fieldLabels = lines.filter((line) => /:\s*$/.test(line)).length;

		return blankLines >= 2 && fieldLabels >= 2;
	});
}

export function validateArticle(raw, contentProfile = getDefaultContentProfile()) {
	const validation = contentProfile.article.validation;
	const articleTopicTags = new Set(contentProfile.article.taxonomy.topic);
	const articleLevelTags = new Set(contentProfile.article.taxonomy.level);
	const articleApproachTags = new Set(contentProfile.article.taxonomy.approach);
	const allowedArticleTags = new Set([...articleTopicTags, ...articleLevelTags, ...articleApproachTags]);
	if (!raw || typeof raw !== 'object') throw new Error('Codex did not return an article object.');
	const deliveryStatus = String(raw.deliveryStatus || '').trim();
	const blockingReason = stripHtml(String(raw.blockingReason || '')).slice(0, 1_000);
	if (deliveryStatus !== 'ready') {
		throw new Error(`Codex could not deliver an article: ${blockingReason || 'No blocking reason was provided.'}`);
	}

	const title = String(raw.title || '').trim();
	const content = sanitizeArticleHtml(String(raw.content || '').trim());
	const plainContent = stripHtml(content);
	const wordCount = plainContent.split(/\s+/).filter(Boolean).length;
	const headingCount = (content.match(/<h2(?:\s[^>]*)?>/gi) || []).length;
	const paragraphCount = (content.match(/<p(?:\s[^>]*)?>/gi) || []).length;
	const operationalFailure =
		/(?:job\.json|bwrap|namespace|ad alanı|izin hatası|dosya(?:ya)? eriş(?:em|ilemedi)|makale (?:hazırlanamadı|oluşturulmadı)|internal reasoning)/i;
	if (title.length < 8 || title.length > 180) throw new Error('Generated title length is invalid.');
	if (wordCount < validation.minimumWords) {
		throw new Error(`Generated article is too short (${wordCount}/${validation.minimumWords} words).`);
	}
	if (headingCount < validation.minimumHeadings || paragraphCount < validation.minimumParagraphs) {
		throw new Error(
			`Generated article structure is too shallow (${headingCount} sections, ${paragraphCount} paragraphs).`,
		);
	}
	if (operationalFailure.test(`${title}\n${plainContent}\n${blockingReason}`)) {
		throw new Error('Generated output contains an operational failure instead of an article.');
	}
	if (hasUnfilledTemplate(content)) {
		throw new Error('Generated article contains an unfilled example template.');
	}

	const slug = slugify(String(raw.slug || title));
	if (!slug) throw new Error('Generated slug is empty.');
	const description = stripHtml(String(raw.description || plainContent.slice(0, 180))).slice(0, 240);
	const seoTitle = stripHtml(String(raw.seoTitle || title)).slice(0, 70);
	const metaDescription = stripHtml(String(raw.metaDescription || description)).slice(0, 180);
	if (!Array.isArray(raw.tags) || raw.tags.length !== 3) {
		throw new Error(
			'Generated article must include exactly 3 distinct tags: one topic, one reader level, and one approach.',
		);
	}
	const tags = raw.tags.map((tag) => (typeof tag === 'string' ? stripHtml(tag).normalize('NFKC') : ''));
	if (tags.some((tag) => tag.length < 2 || tag.length > 40)) {
		throw new Error('Generated article tags must be non-empty strings between 2 and 40 characters.');
	}
	const normalizedTagKeys = tags.map((tag) => tag.toLocaleLowerCase('tr-TR'));
	if (new Set(normalizedTagKeys).size !== tags.length) {
		throw new Error('Generated article tags must be distinct.');
	}
	if (tags.some((tag) => !allowedArticleTags.has(tag))) {
		throw new Error('Generated article tags must use the supported editorial taxonomy.');
	}
	const taxonomyErrors = [];
	if (tags.filter((tag) => articleTopicTags.has(tag)).length !== 1) {
		taxonomyErrors.push('exactly one topic tag');
	}
	if (tags.filter((tag) => articleLevelTags.has(tag)).length !== 1) {
		taxonomyErrors.push('exactly one reader-level tag');
	}
	if (tags.filter((tag) => articleApproachTags.has(tag)).length !== 1) {
		taxonomyErrors.push('exactly one approach tag');
	}
	if (taxonomyErrors.length > 0) {
		throw new Error(`Generated article must include ${taxonomyErrors.join(', and ')}.`);
	}
	const warnings = Array.isArray(raw.warnings)
		? raw.warnings
				.flatMap((warning) => {
					const sanitizedWarning = stripHtml(String(warning));

					return sanitizedWarning ? [sanitizedWarning] : [];
				})
				.slice(0, 20)
		: [];
	if (warnings.some((warning) => operationalFailure.test(warning))) {
		throw new Error('Generated warnings report an operational failure; draft creation was stopped.');
	}
	const sources = Array.isArray(raw.sources)
		? raw.sources
				.flatMap((source) => {
					const sanitizedSource = {
						title: stripHtml(String(source?.title || '')).slice(0, 200),
						url: String(source?.url || '').trim(),
					};

					return sanitizedSource.title && /^https?:\/\//.test(sanitizedSource.url) ? [sanitizedSource] : [];
				})
				.slice(0, 30)
		: [];

	return {
		deliveryStatus,
		title,
		slug,
		description,
		content,
		readTime: calculateReadTime(content, validation.wordsPerMinute),
		seoTitle,
		metaDescription,
		tags,
		warnings,
		sources,
	};
}

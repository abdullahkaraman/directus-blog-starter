import { contentProfileFor } from './content-profile.mjs';
import { stripHtml } from './article.mjs';

function encodeQuery(parameters) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(parameters)) query.set(key, value);

	return query.toString();
}

function cmsFor(config) {
	return contentProfileFor(config).cms;
}

function itemPath(config, id = null) {
	const collection = cmsFor(config).collection;
	return id === null ? `/items/${collection}` : `/items/${collection}/${encodeURIComponent(id)}`;
}

function normalizePost(config, post) {
	if (!post || typeof post !== 'object') return null;
	const { fields, seoFields } = cmsFor(config);
	const seo = post[fields.seo] || null;
	return {
		id: post[fields.id],
		title: post[fields.title],
		slug: post[fields.slug],
		description: post[fields.description],
		content: post[fields.content],
		readTime: post[fields.readTime],
		status: post[fields.status],
		publishedAt: post[fields.publishedAt],
		seo,
		tags: Array.isArray(seo?.[seoFields.additional]?.[seoFields.tags])
			? seo[seoFields.additional][seoFields.tags].map(String).slice(0, 8)
			: [],
	};
}

function articlePayload(config, article) {
	const { fields, seoFields } = cmsFor(config);
	return {
		[fields.title]: article.title,
		[fields.description]: article.description,
		[fields.content]: article.content,
		[fields.readTime]: article.readTime,
		[fields.seo]: {
			[seoFields.title]: article.seoTitle,
			[seoFields.metaDescription]: article.metaDescription,
			[seoFields.additional]: { [seoFields.tags]: article.tags },
		},
	};
}

async function directusRequest(config, path, options = {}) {
	const response = await fetch(`${config.directusUrl}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${config.directusToken}`,
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		const body = await response.json().catch(() => null);
		throw new Error(`Directus ${response.status}: ${JSON.stringify(body)}`);
	}

	const body = await response.json().catch(() => null);

	return body?.data;
}

async function uniqueSlug(config, baseSlug) {
	const { fields } = cmsFor(config);
	for (let index = 0; index < 100; index += 1) {
		const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
		const query = encodeQuery({
			[`filter[${fields.slug}][_eq]`]: candidate,
			fields: fields.id,
			limit: '1',
		});
		const matches = await directusRequest(config, `${itemPath(config)}?${query}`);
		if (!Array.isArray(matches) || matches.length === 0) return candidate;
	}

	throw new Error('Could not allocate a unique Directus slug.');
}

export async function getEditorialContext(config) {
	const { fields, seoFields, statuses, recentLimit } = cmsFor(config);
	const query = encodeQuery({
		[`filter[${fields.status}][_eq]`]: statuses.published,
		fields: [
			fields.title,
			fields.slug,
			fields.description,
			fields.content,
			fields.publishedAt,
			`${fields.seo}.${seoFields.additional}`,
		].join(','),
		sort: `-${fields.publishedAt}`,
		limit: String(recentLimit),
	});
	const posts = await directusRequest(config, `${itemPath(config)}?${query}`);

	return {
		fetchedAt: new Date().toISOString(),
		recentArticles: Array.isArray(posts)
			? posts.map((rawPost) => {
					const post = normalizePost(config, rawPost);
					return {
						title: String(post.title || '').trim(),
						slug: String(post.slug || '').trim(),
						description: stripHtml(String(post.description || '')).slice(0, 300),
						publishedAt: post.publishedAt || null,
						tags: post.tags,
						contentExcerpt: stripHtml(String(post.content || '')).slice(0, 1_000),
					};
				})
			: [],
	};
}

export async function createDirectusDraft(config, article) {
	const profile = contentProfileFor(config);
	const { fields, statuses } = profile.cms;
	const slug = await uniqueSlug(config, article.slug);
	const rawPost = await directusRequest(config, itemPath(config), {
		method: 'POST',
		body: JSON.stringify({
			...articlePayload(config, article),
			[fields.slug]: slug,
			[fields.status]: statuses.draft,
			[fields.publishedAt]: null,
		}),
	});
	const post = normalizePost(config, rawPost);
	const previewUrl = `${config.siteUrl}${profile.routes.previewPost}/${encodeURIComponent(slug)}?token=${encodeURIComponent(config.previewSecret)}`;

	return { id: post.id, slug, previewUrl };
}

export async function getDirectusDraftForEdit(config, postId) {
	if (!postId) throw new Error('Directus post ID is required for editing.');
	const { fields, statuses } = cmsFor(config);
	const rawPost = await directusRequest(
		config,
		`${itemPath(config, postId)}?fields=${Object.values(fields).join(',')}`,
	);
	const post = normalizePost(config, rawPost);
	if (!post?.id || !post.slug) throw new Error('Directus draft could not be found for editing.');
	if (post.status !== statuses.draft) {
		throw new Error(
			`Yalnız draft durumundaki yazılar düzenlenebilir; mevcut durum: ${String(post.status || 'bilinmiyor')}.`,
		);
	}

	return post;
}

export async function getDirectusPostForLearning(config, postId) {
	if (!postId) throw new Error('Directus post ID is required for learning.');
	const { fields } = cmsFor(config);
	const rawPost = await directusRequest(
		config,
		`${itemPath(config, postId)}?fields=${Object.values(fields).join(',')}`,
	);
	const post = normalizePost(config, rawPost);
	if (!post?.id || !post.slug) throw new Error('Directus post could not be found for learning.');

	return {
		id: post.id,
		title: post.title,
		slug: post.slug,
		description: post.description,
		content: post.content,
		status: post.status,
		publishedAt: post.publishedAt,
		seo: post.seo,
	};
}

export async function updateDirectusDraft(config, postId, currentSlug, article) {
	const profile = contentProfileFor(config);
	const { fields, statuses } = profile.cms;
	const rawCurrent = await directusRequest(
		config,
		`${itemPath(config, postId)}?fields=${[fields.id, fields.slug, fields.status, fields.publishedAt].join(',')}`,
	);
	const current = normalizePost(config, rawCurrent);
	if (!current?.id || current.slug !== currentSlug) throw new Error('Directus draft changed or could not be found.');
	if (current.status !== statuses.draft) {
		throw new Error(
			`Taslak artık düzenlenebilir durumda değil; mevcut durum: ${String(current.status || 'bilinmiyor')}.`,
		);
	}
	const rawPost = await directusRequest(config, itemPath(config, postId), {
		method: 'PATCH',
		body: JSON.stringify({
			...articlePayload(config, article),
			[fields.slug]: currentSlug,
		}),
	});
	const post = normalizePost(config, rawPost);
	const previewUrl = `${config.siteUrl}${profile.routes.previewPost}/${encodeURIComponent(currentSlug)}?token=${encodeURIComponent(config.previewSecret)}`;

	return { id: post.id || postId, slug: currentSlug, previewUrl };
}

export async function publishDirectusPost(config, postId) {
	if (!postId) throw new Error('Directus post ID is required for publishing.');
	const { fields, statuses } = cmsFor(config);
	const rawCurrent = await directusRequest(
		config,
		`${itemPath(config, postId)}?fields=${[fields.id, fields.title, fields.slug, fields.status, fields.publishedAt].join(',')}`,
	);
	const current = normalizePost(config, rawCurrent);
	if (!current?.id || !current.slug) throw new Error('Directus post could not be found for publishing.');
	if (![statuses.draft, statuses.published].includes(current.status)) {
		throw new Error(
			`Yalnız draft durumundaki yazılar yayımlanabilir; mevcut durum: ${String(current.status || 'bilinmiyor')}.`,
		);
	}
	const publishedAt = current.publishedAt || new Date().toISOString();
	if (current.status !== statuses.published) {
		await directusRequest(config, itemPath(config, postId), {
			method: 'PATCH',
			body: JSON.stringify({ [fields.status]: statuses.published, [fields.publishedAt]: publishedAt }),
		});
	}

	return { title: current.title, slug: current.slug, publishedAt };
}

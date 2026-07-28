import { BlockPost, Globals, Page, PageBlock, Post, Redirect, Schema } from '@/types/directus-schema';
import { getDirectus, getDirectusServerToken } from './directus';
import { readItems, aggregate, readItem, readSingleton, withToken, QueryFilter } from '@directus/sdk';
import { RedirectError } from '../redirects';
import { cache } from 'react';

/**
 * Page fields configuration for Directus queries
 *
 * This defines the complete field structure for pages including:
 * - Basic page metadata (title, id)
 * - SEO fields for search engine optimization
 * - Complex nested content blocks (hero, gallery, pricing, forms, etc.)
 * - All nested relationships and dynamic content fields
 */
const pageFields = [
	'title',
	'seo',
	'id',
	{
		blocks: [
			'id',
			'background',
			'collection',
			'item',
			'sort',
			'hide_block',
			{
				item: {
					block_richtext: ['id', 'tagline', 'headline', 'content', 'alignment'],
					block_gallery: ['id', 'tagline', 'headline', { items: ['id', 'directus_file', 'sort'] }],
					block_pricing: [
						'id',
						'tagline',
						'headline',
						{
							pricing_cards: [
								'id',
								'title',
								'description',
								'price',
								'badge',
								'features',
								'is_highlighted',
								{
									button: ['id', 'label', 'variant', 'url', 'type', { page: ['permalink'] }, { post: ['slug'] }],
								},
							],
						},
					],
					block_hero: [
						'id',
						'tagline',
						'headline',
						'description',
						'layout',
						'image',
						{
							button_group: [
								'id',
								{
									buttons: ['id', 'label', 'variant', 'url', 'type', { page: ['permalink'] }, { post: ['slug'] }],
								},
							],
						},
					],
					block_posts: ['id', 'tagline', 'headline', 'collection', 'limit'],
					block_form: [
						'id',
						'tagline',
						'headline',
						{
							form: [
								'id',
								'title',
								'submit_label',
								'success_message',
								'on_success',
								'success_redirect_url',
								'is_active',
								{
									fields: [
										'id',
										'name',
										'type',
										'label',
										'placeholder',
										'help',
										'validation',
										'width',
										'choices',
										'required',
										'sort',
									],
								},
							],
						},
					],
				},
			},
		],
	},
];

type SiteGlobals = Pick<
	Globals,
	'id' | 'title' | 'description' | 'logo' | 'logo_dark_mode' | 'social_links' | 'accent_color' | 'favicon'
>;

type SiteNavigation = {
	id: string;
	title?: string | null;
	items?: any[] | string[] | null;
};

const formatDirectusError = (error: unknown) => {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = String((error as { message: unknown }).message);
		const status = (error as { response?: { status?: number } }).response?.status;

		return status ? `${message} (status ${status})` : message;
	}

	return error instanceof Error ? error.message : String(error);
};

/**
 * Fetches page data by permalink, including all nested blocks and dynamically fetching blog posts if required.
 */
export const fetchPageData = async (permalink: string, postPage = 1, token?: string, preview?: boolean) => {
	const { directus } = getDirectus();
	const effectiveToken = token || getDirectusServerToken();

	try {
		const pageData = (await directus.request(
			withToken(
				effectiveToken as string,
				readItems('pages', {
					filter: preview
						? { permalink: { _eq: permalink } }
						: { permalink: { _eq: permalink }, status: { _eq: 'published' } },
					limit: 1,
					fields: pageFields as any,
					deep: {
						blocks: { _sort: ['sort'], _filter: { hide_block: { _neq: true } } },
					},
				}),
			),
		)) as Page[];

		if (!pageData.length) {
			throw new Error('Page not found');
		}

		const page = pageData[0];

		// Dynamic Content Enhancement:
		// Some blocks need additional data fetched at runtime
		// This is where we enhance static block data with dynamic content
		if (Array.isArray(page.blocks)) {
			await Promise.all(
				(page.blocks as PageBlock[]).map(async (block) => {
				// Handle dynamic posts blocks - these blocks display a list of posts
				// The posts are fetched dynamically based on the block's configuration
				if (
					block.collection === 'block_posts' &&
					block.item &&
					typeof block.item !== 'string' &&
					'collection' in block.item &&
					block.item.collection === 'posts'
				) {
					const blockPost = block.item as BlockPost;
					const limit = blockPost.limit ?? 6; // Default to 6 posts if no limit specified

					// Fetch the actual posts data for this block
					// Always fetch published posts only (no preview mode for dynamic content)
					const posts: Post[] = await directus.request(
						withToken(
							effectiveToken as string,
							readItems('posts', {
								filter: { status: { _eq: 'published' } },
								fields: ['id', 'title', 'description', 'slug', 'image', 'published_at'],
								sort: ['-published_at', '-date_created'],
								limit,
								page: postPage,
							}),
						),
					);

					// Attach the fetched posts to the block for frontend rendering
					(block.item as BlockPost & { posts: Post[] }).posts = posts;
				}
				}),
			);
		}

		return page;
	} catch (error) {
		console.warn('Error fetching page data:', formatDirectusError(error));
		throw new Error('Failed to fetch page data');
	}
};

/**
 * Fetches page data by id and version
 */
const fetchPageDataById = async (id: string, version?: string, token?: string): Promise<Page> => {
	if (!id || id.trim() === '') {
		throw new Error('Invalid id: id must be a non-empty string');
	}
	if (!version || version.trim() === '') {
		throw new Error('Invalid version: version must be a non-empty string');
	}

	const { directus } = getDirectus();
	const effectiveToken = token || getDirectusServerToken();

	try {
		return (await directus.request(
			withToken(
				effectiveToken as string,
				readItem('pages', id, {
					version,
					fields: pageFields as any,
					deep: {
						blocks: { _sort: ['sort'], _filter: { hide_block: { _neq: true } } },
					},
				}),
			),
		)) as Page;
	} catch (error) {
		console.warn('Error fetching versioned page:', formatDirectusError(error));
		throw new Error('Failed to fetch versioned page');
	}
};

/**
 * Helper function to get page ID by permalink
 */
const getPageIdByPermalink = async (permalink: string, token?: string) => {
	if (!permalink || permalink.trim() === '') {
		throw new Error('Invalid permalink: permalink must be a non-empty string');
	}

	const { directus } = getDirectus();
	const effectiveToken = token || getDirectusServerToken();

	try {
		const pageData = (await directus.request(
			withToken(
				effectiveToken as string,
				readItems('pages', {
					filter: { permalink: { _eq: permalink } },
					limit: 1,
					fields: ['id'],
				}),
			),
		)) as Pick<Page, 'id'>[];

		return pageData.length > 0 ? pageData[0].id : null;
	} catch (error) {
		console.warn('Error getting page ID:', formatDirectusError(error));

		return null;
	}
};

/**
 * Helper function to get post ID by slug
 */
export const getPostIdBySlug = async (slug: string, token?: string) => {
	if (!slug || slug.trim() === '') {
		throw new Error('Invalid slug: slug must be a non-empty string');
	}

	const { directus } = getDirectus();
	const effectiveToken = token || getDirectusServerToken();

	try {
		const postData = (await directus.request(
			withToken(
				effectiveToken as string,
				readItems('posts', {
					filter: { slug: { _eq: slug } },
					limit: 1,
					fields: ['id'],
				}),
			),
		)) as Pick<Post, 'id'>[];

		return postData.length > 0 ? postData[0].id : null;
	} catch (error) {
		console.warn('Error getting post ID:', formatDirectusError(error));

		return null;
	}
};

/**
 * Fetches a single blog post by ID and version
 */
export const fetchPostByIdAndVersion = async (
	id: string,
	version: string,
	slug: string,
	token?: string,
): Promise<{ post: Post; relatedPosts: Post[] }> => {
	if (!id || id.trim() === '') {
		throw new Error('Invalid id: id must be a non-empty string');
	}
	if (!version || version.trim() === '') {
		throw new Error('Invalid version: version must be a non-empty string');
	}
	if (!slug || slug.trim() === '') {
		throw new Error('Invalid slug: slug must be a non-empty string');
	}

	const { directus } = getDirectus();
	const effectiveToken = token || getDirectusServerToken();

	try {
		const [postData, relatedPosts] = await Promise.all([
			directus.request(
				withToken(
					effectiveToken as string,
					readItem('posts', id, {
						version,
						fields: [
							'id',
							'title',
							'content',
							'image',
							'description',
							'slug',
							'published_at',
							{
								author: ['id', 'first_name', 'last_name', 'email', 'avatar', 'description'],
							},
						],
					}),
				),
			),
			directus.request(
				withToken(
					effectiveToken as string,
					readItems('posts', {
						filter: { slug: { _neq: slug } },
						limit: 2,
						fields: ['id', 'title', 'slug', 'image', 'description'],
					}),
				),
			),
		]);

		return { post: postData as Post, relatedPosts: relatedPosts as Post[] };
	} catch (error) {
		console.warn('Error fetching versioned post:', formatDirectusError(error));
		throw new Error('Failed to fetch versioned post');
	}
};

/**
 * Fetches global site data, header navigation, and footer navigation.
 */
export const fetchSiteData = cache(
	async (): Promise<{
		globals: SiteGlobals;
		headerNavigation: SiteNavigation;
		footerNavigation: SiteNavigation;
	}> => {
		const { directus } = getDirectus();
		const token = getDirectusServerToken();

		try {
			const [globals, headerNavigation, footerNavigation] = await Promise.all([
				directus.request(
					withToken(
						token as string,
						readSingleton('globals', {
							fields: [
								'id',
								'title',
								'description',
								'logo',
								'logo_dark_mode',
								'social_links',
								'accent_color',
								'favicon',
							],
						}),
					),
				),
				directus.request(
					withToken(
						token as string,
						readItem('navigation', 'main', {
							fields: [
								'id',
								'title',
								{
									items: [
										'id',
										'title',
										{
											page: ['permalink'],
											children: ['id', 'title', 'url', { page: ['permalink'] }],
										},
									],
								},
							],
							deep: { items: { _sort: ['sort'] } },
						}),
					),
				),
				directus.request(
					withToken(
						token as string,
						readItem('navigation', 'footer', {
							fields: [
								'id',
								'title',
								{
									items: [
										'id',
										'title',
										{
											page: ['permalink'],
											children: ['id', 'title', 'url', { page: ['permalink'] }],
										},
									],
								},
							],
						}),
					),
				),
			]);

			return { globals, headerNavigation, footerNavigation };
		} catch (error) {
			console.warn('Error fetching site data:', formatDirectusError(error));

			return {
				globals: {
					id: 'fallback',
					title: 'Directus Blog',
					description: 'A blog powered by Next.js and Directus.',
					accent_color: '#6644ff',
				} satisfies SiteGlobals,
				headerNavigation: {
					id: 'main',
					title: 'Main',
					items: [],
				} satisfies SiteNavigation,
				footerNavigation: {
					id: 'footer',
					title: 'Footer',
					items: [],
				} satisfies SiteNavigation,
			};
		}
	},
);

/**
 * Fetches a single blog post by slug and related blog posts excluding the given ID. Handles live preview mode.
 */
export const fetchPostBySlug = async (
	slug: string,
	options?: { draft?: boolean; token?: string },
): Promise<{ post: Post | null; relatedPosts: Post[] }> => {
	const { directus } = getDirectus();
	const { draft, token } = options || {};
	const effectiveToken = token || getDirectusServerToken();

	try {
		const filter: QueryFilter<Schema, Post> = draft
			? { slug: { _eq: slug } }
			: { slug: { _eq: slug }, status: { _eq: 'published' } };

		const [posts, relatedPosts] = await Promise.all([
			directus.request<Post[]>(
				withToken(
					effectiveToken as string,
					readItems<Schema, 'posts', any>('posts', {
						filter,
						limit: 1,
						fields: [
							'id',
							'title',
							'content',
							'image',
							'description',
							'slug',
							'published_at',
							{
								author: ['id', 'first_name', 'last_name', 'email', 'avatar', 'description'],
							},
						],
					}),
				),
			),
			directus.request<Post[]>(
				withToken(
					effectiveToken as string,
					readItems<Schema, 'posts', any>('posts', {
						filter: { slug: { _neq: slug }, status: { _eq: 'published' } },
						limit: 2,
						fields: ['id', 'title', 'slug', 'image', 'description'],
					}),
				),
			),
		]);

		const post: Post | null = posts.length > 0 ? (posts[0] as Post) : null;

		return { post, relatedPosts };
	} catch (error) {
		console.warn('Error in fetchPostBySlug:', formatDirectusError(error));
		throw new Error('Failed to fetch blog post and related posts');
	}
};

/**
 * Fetches posts for the Medium-style homepage. Returns an empty list on API failure
 * so the homepage can render a graceful fallback instead of failing the route.
 */
export const fetchHomepagePosts = async (limit = 9): Promise<Post[]> => {
	const { directus } = getDirectus();
	const token = getDirectusServerToken();
	const baseFields = ['id', 'title', 'description', 'slug', 'image', 'published_at'] as const;
	const authorField = {
		author: ['id', 'first_name', 'last_name', 'email', 'avatar', 'description'],
	};

	const fetchPosts = (fields: any[]) =>
		directus.request<Post[]>(
			withToken(
				token as string,
				readItems<Schema, 'posts', any>('posts', {
					filter: { status: { _eq: 'published' } },
					limit,
					sort: ['-published_at', '-date_created'],
					fields,
				}),
			),
		) as Promise<Post[]>;

	try {
		return await fetchPosts([...baseFields, 'read_time', authorField]);
	} catch (error) {
		console.warn('Error fetching homepage posts:', formatDirectusError(error));

		try {
			return await fetchPosts([...baseFields, authorField]);
		} catch (fallbackError) {
			console.warn('Error fetching homepage posts without read_time:', formatDirectusError(fallbackError));

			return [];
		}
	}
};

/**
 * Fetches paginated blog posts.
 */
export const fetchPaginatedPosts = async (limit: number, page: number): Promise<Post[]> => {
	const { directus } = getDirectus();
	const token = getDirectusServerToken();
	try {
		const response = (await directus.request(
			withToken(
				token as string,
				readItems('posts', {
					filter: { status: { _eq: 'published' } },
					limit,
					page,
					sort: ['-published_at', '-date_created'],
					fields: ['id', 'title', 'description', 'slug', 'image', 'published_at'],
				}),
			),
		)) as Post[];

		return response;
	} catch (error) {
		console.warn('Error fetching paginated posts:', formatDirectusError(error));
		throw new Error('Failed to fetch paginated posts');
	}
};

/**
 * Fetches the total number of published blog posts.
 */
export const fetchTotalPostCount = async (): Promise<number> => {
	const { directus } = getDirectus();
	const token = getDirectusServerToken();

	try {
		const response = await directus.request(
			withToken(
				token as string,
				aggregate('posts', {
					query: {
						filter: { status: { _eq: 'published' } },
					},
					aggregate: { count: '*' },
				}),
			),
		);

		return Number(response[0]?.count) || 0;
	} catch (error) {
		console.warn('Error fetching total post count:', formatDirectusError(error));

		return 0;
	}
};

export async function fetchRedirects(): Promise<Pick<Redirect, 'url_from' | 'url_to' | 'response_code'>[]> {
	const { directus } = getDirectus();
	const token = getDirectusServerToken();
	const response = await directus.request(
		withToken(
			token as string,
			readItems('redirects', {
				filter: {
					_and: [
						{
							url_from: { _nnull: true },
						},
						{
							url_to: { _nnull: true },
						},
					],
				},
				fields: ['url_from', 'url_to', 'response_code'],
			}),
		),
	);

	return response || [];
}

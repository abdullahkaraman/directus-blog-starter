import { getDirectusServerToken, useDirectus } from '@/lib/directus/directus';
import type { MetadataRoute } from 'next';

const formatDirectusError = (error: unknown) => {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = String((error as { message: unknown }).message);
		const status = (error as { response?: { status?: number } }).response?.status;

		return status ? `${message} (status ${status})` : message;
	}

	return error instanceof Error ? error.message : String(error);
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
	if (!siteUrl) {
		throw new Error('Environment variable NEXT_PUBLIC_SITE_URL is not set');
	}
	const fallbackSitemap = [{ url: siteUrl, lastModified: new Date().toISOString() }];

	const { directus, readItems, withToken } = useDirectus();
	const token = getDirectusServerToken();

	try {
		const pagesPromise = directus.request(
			withToken(
				token as string,
				readItems('pages', {
					filter: { status: { _eq: 'published' } },
					fields: ['permalink'],
					limit: -1,
				}),
			),
		);

		const postsPromise = directus.request(
			withToken(
				token as string,
				readItems('posts', {
					filter: { status: { _eq: 'published' } },
					fields: ['slug'],
					limit: -1,
				}),
			),
		);

		const [pages, posts] = await Promise.all([pagesPromise, postsPromise]);

		const pageUrls = pages
			.filter((page: { permalink: string | null | undefined }) => page.permalink)
			.map((page: { permalink: string | null | undefined }) => ({
				url: `${process.env.NEXT_PUBLIC_SITE_URL}${page.permalink}`,
				lastModified: new Date().toISOString(),
			}));

		const postUrls = posts
			.filter((post: { slug: string | null | undefined }) => post.slug)
			.map((post: { slug: string | null | undefined }) => ({
				url: `${process.env.NEXT_PUBLIC_SITE_URL}/blog/${post.slug}`,
				lastModified: new Date().toISOString(),
			}));

		return [...pageUrls, ...postUrls];
	} catch (error) {
		console.warn('Error generating sitemap:', formatDirectusError(error));

		return fallbackSitemap;
	}
}

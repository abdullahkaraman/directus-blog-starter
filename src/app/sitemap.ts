import { getDirectus, getDirectusServerToken } from '@/lib/directus/directus';
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
		console.warn('Skipping sitemap generation because NEXT_PUBLIC_SITE_URL is not set');

		return [];
	}
	const fallbackSitemap = [{ url: siteUrl, lastModified: new Date().toISOString() }];

	try {
		const { directus, readItems, withToken } = getDirectus();
		const token = getDirectusServerToken();
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

		const pageUrls = pages.reduce<MetadataRoute.Sitemap>((urls, page) => {
			if (page.permalink) {
				urls.push({
					url: `${siteUrl}${page.permalink}`,
					lastModified: new Date().toISOString(),
				});
			}

			return urls;
		}, []);

		const postUrls = posts.reduce<MetadataRoute.Sitemap>((urls, post) => {
			if (post.slug) {
				urls.push({
					url: `${siteUrl}/blog/${post.slug}`,
					lastModified: new Date().toISOString(),
				});
			}

			return urls;
		}, []);

		return [...pageUrls, ...postUrls];
	} catch (error) {
		console.warn('Error generating sitemap:', formatDirectusError(error));

		return fallbackSitemap;
	}
}

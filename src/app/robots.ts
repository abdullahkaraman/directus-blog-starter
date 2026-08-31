import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
	const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '');

	return {
		...(siteUrl ? { host: siteUrl, sitemap: `${siteUrl}/sitemap.xml` } : {}),
		rules: {
			allow: '/',
			disallow: ['/api/draft', '/preview/', '/write'],
			userAgent: '*',
		},
	};
}

import type { NextConfig } from 'next';
import initializeBundleAnalyzer from '@next/bundle-analyzer';
import { generateRedirects } from './src/lib/redirects';

const withBundleAnalyzer = initializeBundleAnalyzer({
	enabled: process.env.BUNDLE_ANALYZER_ENABLED === 'true',
});

const directusUrl = process.env.NEXT_PUBLIC_DIRECTUS_URL ?? '';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
const isProduction = process.env.NODE_ENV === 'production';
const isVisualEditingEnabled = process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING !== 'false';
const directusAssetPattern = (() => {
	if (!directusUrl) return null;
	try {
		const parsed = new URL(directusUrl);
		return {
			protocol: parsed.protocol.replace(':', '') as 'http' | 'https',
			hostname: parsed.hostname,
			port: parsed.port,
			pathname: '/assets/**',
		};
	} catch {
		return null;
	}
})();
const frameAncestors = [
	"'self'",
	...(isProduction ? [] : ['http://localhost:3000']),
	...(isVisualEditingEnabled ? [directusUrl] : []),
]
	.filter(Boolean)
	.join(' ');

const ContentSecurityPolicy = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    frame-src 'self' ${directusUrl};
    style-src 'self' 'unsafe-inline';
    img-src 'self' ${directusUrl} blob: data:;
    media-src 'self' ${directusUrl};
    connect-src 'self' ${siteUrl} ${directusUrl};
    font-src 'self' data:;
    frame-ancestors ${frameAncestors};
    base-uri 'self';
    form-action 'self';
    object-src 'none';
`;

const nextConfig: NextConfig = {
	poweredByHeader: false,
	webpack: (config) => {
		config.cache = false;

		return config;
	},
	images: {
		remotePatterns: [
			...(directusAssetPattern ? [directusAssetPattern] : []),
			{
				protocol: 'http',
				hostname: 'localhost',
				port: '8055',
				pathname: '/assets/**',
			},
		],
	},
	async headers() {
		return [
			{
				source: '/:path*',
				headers: [
					{
						key: 'Content-Security-Policy',
						value: ContentSecurityPolicy.replace(/\n/g, '').trim(),
					},
					{
						key: 'X-Content-Type-Options',
						value: 'nosniff',
					},
					{
						key: 'Strict-Transport-Security',
						value: 'max-age=63072000',
					},
					{
						key: 'Referrer-Policy',
						value: 'strict-origin-when-cross-origin',
					},
					{
						key: 'Permissions-Policy',
						value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
					},
					...(isVisualEditingEnabled
						? []
						: [
								{
									key: 'X-Frame-Options',
									value: 'SAMEORIGIN',
								},
							]),
				],
			},
		];
	},
	async redirects() {
		// generateRedirects handles errors gracefully and returns empty array if Directus is unavailable
		const redirects = await generateRedirects();

		return redirects;
	},
};

export default withBundleAnalyzer(nextConfig);

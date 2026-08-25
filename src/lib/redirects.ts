import type { Redirect as NextRedirect } from 'next/dist/lib/load-custom-routes';
import type { Redirect } from '@/types/directus-schema';

export interface RedirectError {
	type: 'redirect';
	destination: string;
	status: string;
}

function isRedirectError(error: unknown): error is RedirectError {
	return typeof error === 'object' && error !== null && 'type' in error && error.type === 'redirect';
}

export async function generateRedirects(): Promise<NextRedirect[]> {
	const directusUrl = process.env.NEXT_PUBLIC_DIRECTUS_URL?.trim();
	const directusToken = process.env.DIRECTUS_SERVER_TOKEN?.trim();

	if (!directusUrl || !directusToken) return [];

	try {
		const endpoint = new URL('/items/redirects', directusUrl);
		endpoint.searchParams.set('filter[url_from][_nnull]', 'true');
		endpoint.searchParams.set('filter[url_to][_nnull]', 'true');
		endpoint.searchParams.set('fields', 'url_from,url_to,response_code');

		const response = await fetch(endpoint, {
			headers: { Authorization: `Bearer ${directusToken}` },
		});

		if (!response.ok) {
			throw new Error(`Directus redirects request failed with status ${response.status}`);
		}

		const payload = (await response.json()) as {
			data?: Pick<Redirect, 'url_from' | 'url_to' | 'response_code'>[];
		};
		const redirects = payload.data ?? [];

		return redirects
			.filter(
				(redirect): redirect is { url_from: string; url_to: string; response_code: '301' | '302' } =>
					typeof redirect.url_from === 'string' &&
					typeof redirect.url_to === 'string' &&
					(redirect.response_code === '301' || redirect.response_code === '302'),
			)
			.map((redirect) => ({
				source: redirect.url_from,
				destination: redirect.url_to,
				permanent: redirect.response_code === '301',
			}));
	} catch (error) {
		// During build/config evaluation, Directus may not be available yet
		// Log as warning instead of error to avoid failing builds
		const isBuildPhase = process.env.npm_lifecycle_event === 'build' || process.env.NEXT_BUILD === 'true';
		if (isBuildPhase) {
			console.warn(
				'Could not load redirects from Directus during build (this is normal if Directus is not configured/running)',
			);
		} else {
			console.error('Error generating redirects:', error);
		}

		return [];
	}
}

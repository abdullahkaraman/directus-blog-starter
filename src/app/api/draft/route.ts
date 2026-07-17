import { draftMode } from 'next/headers';

import { isValidPreviewToken } from '@/lib/preview-auth';

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const slug = searchParams.get('slug');
	const token = searchParams.get('token');

	if (!isValidPreviewToken(token)) {
		return new Response('Invalid token', {
			status: 401,
			headers: { 'Cache-Control': 'no-store' },
		});
	}

	if (!slug) {
		return new Response('Missing slug', { status: 400 });
	}

	(await draftMode()).enable();

	return new Response(null, {
		status: 307,
		headers: {
			'Cache-Control': 'no-store',
			Location: `/preview/blog/${encodeURIComponent(slug)}`,
		},
	});
}

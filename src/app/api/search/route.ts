import { getDirectus, getDirectusServerToken } from '@/lib/directus/directus';
import { createPublishedPageSearchFilter, createPublishedPostSearchFilter } from '@/lib/directus/search-filters';
import { NextResponse } from 'next/server';

const formatDirectusError = (error: unknown) => {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = String((error as { message: unknown }).message);
		const status = (error as { response?: { status?: number } }).response?.status;

		return status ? `${message} (status ${status})` : message;
	}

	return error instanceof Error ? error.message : String(error);
};

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const search = searchParams.get('search')?.trim() ?? '';

	if (!search || search.length < 3) {
		return NextResponse.json({ error: 'Query must be at least 3 characters.' }, { status: 400 });
	}

	if (search.length > 80) {
		return NextResponse.json({ error: 'Query must be at most 80 characters.' }, { status: 400 });
	}

	const { directus, readItems, withToken } = getDirectus();
	const token = getDirectusServerToken();

	try {
		const [pages, posts] = await Promise.all([
			directus.request(
				withToken(
					token as string,
					readItems('pages', {
						filter: createPublishedPageSearchFilter(search),
						fields: ['id', 'title', 'permalink', 'seo'],
					}),
				),
			),

			directus.request(
				withToken(
					token as string,
					readItems('posts', {
						filter: createPublishedPostSearchFilter(search),
						fields: ['id', 'title', 'description', 'slug'],
					}),
				),
			),
		]);

		const results = [
			...pages.map((page: any) => ({
				id: page.id,
				title: page.title,
				description: page.seo.meta_description,
				type: 'Page',
				link: `/${page.permalink.replace(/^\/+/, '')}`,
			})),

			...posts.map((post: any) => ({
				id: post.id,
				title: post.title,
				description: post.description,
				type: 'Post',
				link: `/blog/${post.slug}`,
			})),
		];

		return NextResponse.json(results, {
			headers: {
				'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
			},
		});
	} catch (error) {
		console.warn('Error fetching search results:', formatDirectusError(error));

		return NextResponse.json([]);
	}
}

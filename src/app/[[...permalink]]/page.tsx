import { fetchHomepagePosts, fetchPageData, fetchSiteData } from '@/lib/directus/fetchers';
import { PageBlock } from '@/types/directus-schema';
import { notFound } from 'next/navigation';
import PageBuilder from '@/components/layout/PageBuilder';
import MediumHomePage from '@/components/home/MediumHomePage';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ permalink?: string[] }> }) {
	const { permalink } = await params;
	const permalinkSegments = permalink || [];
	const resolvedPermalink = `/${permalinkSegments.join('/')}`.replace(/\/$/, '') || '/';

	if (resolvedPermalink === '/') {
		const { globals } = await fetchSiteData();

		return {
			title: globals?.title ?? 'Home',
			description: globals?.description ?? '',
			openGraph: {
				title: globals?.title ?? 'Home',
				description: globals?.description ?? '',
				url: process.env.NEXT_PUBLIC_SITE_URL,
				type: 'website',
			},
		};
	}

	try {
		const page = await fetchPageData(resolvedPermalink);

		if (!page) return;

		return {
			title: page.seo?.title ?? page.title ?? '',
			description: page.seo?.meta_description ?? '',
			openGraph: {
				title: page.seo?.title ?? page.title ?? '',
				description: page.seo?.meta_description ?? '',
				url: `${process.env.NEXT_PUBLIC_SITE_URL}${resolvedPermalink}`,
				type: 'website',
			},
		};
	} catch (error) {
		console.warn('Error loading page metadata:', error instanceof Error ? error.message : String(error));

		return;
	}
}

export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ permalink?: string[] }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { permalink } = await params;
	const { page: requestedPage } = await searchParams;
	const parsedPage = Number.parseInt(requestedPage || '1', 10);
	const currentPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
	const permalinkSegments = permalink || [];
	const resolvedPermalink = `/${permalinkSegments.join('/')}`.replace(/\/$/, '') || '/';

	if (resolvedPermalink === '/') {
		const [{ globals }, posts] = await Promise.all([fetchSiteData(), fetchHomepagePosts(10)]);

		return <MediumHomePage globals={globals} posts={posts} />;
	}

	const page = await fetchPageData(resolvedPermalink, currentPage).catch((error: unknown) => {
		console.warn('Error loading page:', error instanceof Error ? error.message : String(error));

		return null;
	});

	if (!page || !page.blocks) {
		notFound();
	}

	const blocks: PageBlock[] = (page.blocks as PageBlock[]) || [];

	return <PageBuilder sections={blocks} currentPage={currentPage} />;
}

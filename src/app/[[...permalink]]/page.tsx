import {
	fetchHomepagePosts,
	fetchPageData,
	fetchSiteData,
} from '@/lib/directus/fetchers';
import { PageBlock } from '@/types/directus-schema';
import { notFound } from 'next/navigation';
import PageClient from './PageClient';
import MediumHomePage from '@/components/home/MediumHomePage';

export const dynamic = 'force-static';
export const revalidate = 300;

export async function generateStaticParams() {
	return [];
}

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
}: {
	params: Promise<{ permalink?: string[] }>;
}) {
	const { permalink } = await params;
	const permalinkSegments = permalink || [];
	const resolvedPermalink = `/${permalinkSegments.join('/')}`.replace(/\/$/, '') || '/';

	if (resolvedPermalink === '/') {
		const [{ globals }, posts] = await Promise.all([fetchSiteData(), fetchHomepagePosts(10)]);

		return <MediumHomePage globals={globals} posts={posts} />;
	}

	try {
		const page = await fetchPageData(resolvedPermalink);

		if (!page || !page.blocks) {
			notFound();
		}

		const blocks: PageBlock[] = (page.blocks as PageBlock[]) || [];

		return <PageClient sections={blocks} pageId={page.id} />;
	} catch (error) {
		console.warn('Error loading page:', error instanceof Error ? error.message : String(error));
		notFound();
	}
}

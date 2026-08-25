import { draftMode } from 'next/headers';

import PageBuilder from '@/components/layout/PageBuilder';
import { fetchPageData } from '@/lib/directus/fetchers';
import { getDirectusServerToken } from '@/lib/directus/directus';
import { isValidPreviewToken } from '@/lib/preview-auth';
import type { PageBlock } from '@/types/directus-schema';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { robots: { index: false, follow: false } };

type PreviewSearchParams = {
	page?: string;
	token?: string;
};

export default async function PreviewPage({
	params,
	searchParams,
}: {
	params: Promise<{ permalink?: string[] }>;
	searchParams: Promise<PreviewSearchParams>;
}) {
	const [{ permalink }, { page: requestedPage, token }] = await Promise.all([params, searchParams]);
	const draft = await draftMode();

	if (!draft.isEnabled && !isValidPreviewToken(token)) {
		return <div className="mt-[20%] text-center text-xl">401 - Preview Not Authorized</div>;
	}

	const resolvedPermalink = `/${(permalink || []).join('/')}`.replace(/\/$/, '') || '/';
	const parsedPage = Number.parseInt(requestedPage || '1', 10);
	const currentPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

	try {
		const page = await fetchPageData(resolvedPermalink, currentPage, getDirectusServerToken(), true);
		const blocks = (page.blocks as PageBlock[]) || [];

		return <PageBuilder sections={blocks} currentPage={currentPage} />;
	} catch {
		return <div className="mt-[20%] text-center text-xl">404 - Page Not Found</div>;
	}
}

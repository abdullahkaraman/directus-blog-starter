import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/write-auth';

import WriteEditor from './WriteEditor';

export const metadata: Metadata = {
	title: 'Write',
	description: 'Create and publish a new story.',
};

export const dynamic = 'force-dynamic';

export default async function WritePage() {
	if (process.env.ENABLE_PUBLIC_WRITE !== 'true') {
		notFound();
	}
	const session = await auth();

	if (!session) notFound();

	return <WriteEditor />;
}

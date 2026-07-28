'use server';

import { createItem, withToken } from '@directus/sdk';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import { getDirectus, getDirectusServerToken } from '@/lib/directus/directus';
import { calculateReadTimeValue, stripHtml } from '@/lib/posts';
import { sanitizeHtml } from '@/lib/sanitize-html.server';
import { auth } from '@/lib/write-auth';
import { logPublishError } from '@/lib/write-log';
import type { Post } from '@/types/directus-schema';

export type WriteActionState = {
	error?: string;
};

function slugify(title: string) {
	const slug = title
		.toLowerCase()
		.trim()
		.replace(/['"]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || `story-${Date.now()}`;
}

export async function publishPostAction(_state: WriteActionState, formData: FormData): Promise<WriteActionState> {
	const session = await auth();
	if (!session) return { error: 'Unauthorized.' };

	if (process.env.ENABLE_PUBLIC_WRITE !== 'true') {
		return { error: 'Writing is disabled.' };
	}

	const title = String(formData.get('title') || '').trim();
	const rawContent = String(formData.get('content') || '').trim();
	const status = formData.get('status') === 'draft' ? 'draft' : 'published';

	if (title.length < 3) {
		return { error: 'Add a title before publishing.' };
	}

	if (stripHtml(rawContent).length < 20) {
		return { error: 'Write a little more before publishing.' };
	}

	const content = sanitizeHtml(rawContent);
	const slug = slugify(title);
	let createdSlug = slug;
	const payload = {
		title,
		slug,
		content,
		description: stripHtml(content).slice(0, 180),
		read_time: calculateReadTimeValue(content),
		status,
		published_at: status === 'published' ? new Date().toISOString() : null,
	} satisfies Partial<Post>;

	try {
		const token = getDirectusServerToken();
		const { directus } = getDirectus();
		const post = await directus.request<Post>(withToken(token, createItem('posts', payload)));

		createdSlug = post.slug || slug;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		after(() => logPublishError(message));

		return { error: 'Could not publish this story. Check Directus permissions for posts.create.' };
	}

	redirect(`/blog/${createdSlug}`);
}

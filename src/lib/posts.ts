import type { DirectusUser, Post } from '@/types/directus-schema';

export type PostWithAuthor = Post & {
	author?: DirectusUser | string | null;
};

export function getPostHref(post: Pick<Post, 'slug'>) {
	return post.slug ? `/blog/${post.slug}` : '#';
}

export function getPostImage(post: Pick<Post, 'image'>) {
	if (!post.image) return null;

	return typeof post.image === 'string' ? post.image : post.image.id;
}

export function getAuthorName(author?: DirectusUser | string | null) {
	if (!author || typeof author === 'string') return 'Editorial';

	const fullName = [author.first_name, author.last_name].filter(Boolean).join(' ').trim();

	return fullName || author.email || 'Editorial';
}

export function getAuthorAvatar(author?: DirectusUser | string | null) {
	if (!author || typeof author === 'string' || !author.avatar) return null;

	return typeof author.avatar === 'string' ? author.avatar : author.avatar.id;
}

export function formatPostDate(date?: string | null) {
	if (!date) return 'Draft';

	return new Intl.DateTimeFormat('en', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	}).format(new Date(date));
}

export function stripHtml(input?: string | null) {
	if (!input) return '';

	return input
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function getPostExcerpt(post: Pick<Post, 'description' | 'content'>, maxLength = 165) {
	const source = post.description || stripHtml(post.content);
	const normalized = stripHtml(source);

	if (normalized.length <= maxLength) return normalized;

	return `${normalized.slice(0, maxLength).trim()}...`;
}

export function calculateReadTimeValue(content?: string | null) {
	const words = stripHtml(content).split(/\s+/).filter(Boolean).length;

	return Math.ceil(words / 225) || 1;
}

export function calculateReadTime(content?: string | null) {
	return `${calculateReadTimeValue(content)} min read`;
}

export function formatReadTime(readTime?: number | null) {
	if (!readTime) return null;

	return `${Math.max(1, readTime)} min read`;
}

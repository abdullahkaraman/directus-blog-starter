import BlogPostArticle from '@/components/blog/BlogPostArticle';
import { fetchPostBySlug } from '@/lib/directus/fetchers';
import { notFound } from 'next/navigation';

export const dynamic = 'force-static';
export const revalidate = 300;

export async function generateStaticParams() {
	return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;

	try {
		const { post } = await fetchPostBySlug(slug);

		if (!post) return {};

		return {
			title: post.seo?.title ?? post.title,
			description: post.seo?.meta_description ?? post.description ?? '',
			openGraph: {
				title: post.seo?.title ?? post.title,
				description: post.seo?.meta_description ?? post.description ?? '',
				type: 'article',
				url: `${process.env.NEXT_PUBLIC_SITE_URL}/blog/${slug}`,
			},
		};
	} catch (error) {
		console.warn('Error loading post metadata:', error instanceof Error ? error.message : String(error));

		return {};
	}
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;

	try {
		const { post, relatedPosts } = await fetchPostBySlug(slug);

		if (!post) {
			notFound();
		}

		return <BlogPostArticle post={post} relatedPosts={relatedPosts} slug={slug} />;
	} catch (error) {
		console.warn('Error loading blog post:', error instanceof Error ? error.message : String(error));
		notFound();
	}
}

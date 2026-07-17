import Link from 'next/link';

import ArticleUtilityBar from '@/components/blog/ArticleUtilityBar';
import DirectusImage from '@/components/shared/DirectusImage';
import {
	calculateReadTime,
	formatPostDate,
	formatReadTime,
	getAuthorAvatar,
	getAuthorName,
	getPostExcerpt,
	getPostHref,
	getPostImage,
} from '@/lib/posts';
import { renderRichText } from '@/lib/rich-text';
import type { DirectusUser, Post } from '@/types/directus-schema';

type BlogPostArticleProps = {
	post: Post;
	relatedPosts: Post[];
	slug: string;
};

export default function BlogPostArticle({ post, relatedPosts, slug }: BlogPostArticleProps) {
	const author = post.author as DirectusUser | null;
	const authorName = getAuthorName(author);
	const postUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/blog/${slug}`;
	const coverImage = getPostImage(post);
	const authorAvatar = getAuthorAvatar(author);
	const content = renderRichText(post.content);
	const readTime = formatReadTime(post.read_time) ?? calculateReadTime(post.content);

	return (
		<article className="bg-white text-neutral-900">
			<header className="mx-auto max-w-3xl px-6 pb-8 pt-14 sm:pt-20">
				<p className="mb-5 text-sm font-medium uppercase tracking-[0.14em] text-emerald-800">Published story</p>
				<h1 className="font-serif text-5xl leading-[1.04] tracking-normal text-neutral-950 sm:text-6xl">
					{post.title}
				</h1>
				{getPostExcerpt(post, 190) && (
					<p className="mt-6 text-xl leading-8 text-neutral-600">{getPostExcerpt(post, 190)}</p>
				)}

				<div className="mt-8 flex items-center gap-4 border-y border-neutral-200 py-5">
					{authorAvatar ? (
						<DirectusImage
							uuid={authorAvatar}
							alt={authorName}
							width={48}
							height={48}
							className="size-12 rounded-full object-cover"
						/>
					) : (
						<div className="flex size-12 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700">
							{authorName.slice(0, 1).toUpperCase()}
						</div>
					)}
					<div>
						<p className="text-sm font-semibold text-neutral-950">{authorName}</p>
						<p className="mt-1 text-sm text-neutral-500">
							{formatPostDate(post.published_at)} · {readTime}
						</p>
					</div>
				</div>
			</header>

			{coverImage && (
				<figure className="mx-auto max-w-5xl px-6">
					<div className="relative aspect-[16/9] overflow-hidden rounded-md bg-neutral-100">
						<DirectusImage
							uuid={coverImage}
							alt={post.title}
							fill
							priority
							sizes="(max-width: 1024px) 100vw, 1024px"
							className="object-cover"
						/>
					</div>
					<figcaption className="mt-3 text-center text-sm text-neutral-500">{post.title}</figcaption>
				</figure>
			)}

			<ArticleUtilityBar postTitle={post.title} postUrl={postUrl} />

			<div className="mx-auto max-w-3xl px-6 pb-16">
				<div
					className="prose prose-lg max-w-none bg-white font-serif text-neutral-900 prose-neutral prose-headings:font-sans prose-headings:font-semibold prose-headings:tracking-normal prose-headings:text-neutral-950 prose-p:leading-8 prose-p:text-neutral-900 prose-strong:text-neutral-950 prose-a:text-emerald-800 prose-blockquote:border-l-[6px] prose-blockquote:border-neutral-950 prose-blockquote:pl-6 prose-blockquote:font-serif prose-blockquote:text-2xl prose-blockquote:italic prose-blockquote:leading-9 prose-img:mx-auto prose-img:rounded-md prose-figcaption:text-center prose-code:rounded prose-code:bg-neutral-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.9em] prose-pre:rounded-md prose-pre:bg-neutral-950 prose-pre:text-neutral-100"
					dangerouslySetInnerHTML={{ __html: content }}
				/>

				<section className="mt-16 rounded-md border border-neutral-200 bg-neutral-50 p-8">
					<h2 className="font-serif text-3xl text-neutral-950">Get the next story in your inbox</h2>
					<p className="mt-3 text-base leading-7 text-neutral-600">
						Subscribe for thoughtful essays and product notes. No noise, just the next good read.
					</p>
					<form className="mt-6 flex flex-col gap-3 sm:flex-row">
						<input
							type="email"
							placeholder="Email address"
							className="min-h-11 flex-1 rounded-full border border-neutral-300 bg-white px-4 text-sm text-neutral-900 outline-none ring-0 placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-0"
						/>
						<button type="button" className="rounded-full bg-neutral-950 px-6 py-3 text-sm font-medium text-white">
							Subscribe
						</button>
					</form>
				</section>

				{relatedPosts.length > 0 && (
					<section className="mt-16 border-t border-neutral-200 pt-10">
						<h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-950">More to read</h2>
						<div className="mt-6 grid gap-6 sm:grid-cols-2">
							{relatedPosts.map((relatedPost) => (
								<Link key={relatedPost.id} href={getPostHref(relatedPost)} className="group">
									<p className="font-serif text-2xl leading-tight text-neutral-950 group-hover:text-emerald-800">
										{relatedPost.title}
									</p>
									{getPostExcerpt(relatedPost, 110) && (
										<p className="mt-2 line-clamp-2 text-sm leading-6 text-neutral-500">
											{getPostExcerpt(relatedPost, 110)}
										</p>
									)}
								</Link>
							))}
						</div>
					</section>
				)}
			</div>
		</article>
	);
}

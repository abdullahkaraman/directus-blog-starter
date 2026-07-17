import Link from 'next/link';
import { Bookmark, Clock3, Search, Sparkles, UserRound } from 'lucide-react';

import DirectusImage from '@/components/shared/DirectusImage';
import Container from '@/components/ui/container';
import type { Globals, Post } from '@/types/directus-schema';
import {
	formatPostDate,
	formatReadTime,
	getAuthorAvatar,
	getAuthorName,
	getPostExcerpt,
	getPostHref,
	getPostImage,
	type PostWithAuthor,
} from '@/lib/posts';

type MediumHomePageProps = {
	posts: PostWithAuthor[];
	globals?: Pick<Globals, 'title' | 'description' | 'tagline'> | null;
};

const topics = ['Design Systems', 'Product', 'Software Engineering', 'Writing', 'Startups', 'Culture', 'AI'];

function PostMeta({ post }: { post: PostWithAuthor }) {
	const readTime = formatReadTime(post.read_time);

	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
			<span>{getAuthorName(post.author)}</span>
			<span aria-hidden="true">·</span>
			<span>{formatPostDate(post.published_at)}</span>
			{readTime && (
				<>
					<span aria-hidden="true">·</span>
					<span className="inline-flex items-center gap-1">
						<Clock3 className="size-3" />
						{readTime}
					</span>
				</>
			)}
		</div>
	);
}

function FeaturedPost({ post }: { post: PostWithAuthor }) {
	const image = getPostImage(post);

	return (
		<Link
			href={getPostHref(post)}
			className="group grid gap-6 border-b border-neutral-200 pb-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]"
		>
			<div className="flex min-h-[360px] flex-col justify-end">
				<div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600">
					<Sparkles className="size-3.5 text-emerald-700" />
					Featured today
				</div>
				<PostMeta post={post} />
				<h1 className="mt-4 max-w-3xl font-serif text-5xl leading-[1.02] tracking-normal text-neutral-950 sm:text-6xl lg:text-7xl">
					{post.title}
				</h1>
				<p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-600">{getPostExcerpt(post, 210)}</p>
			</div>
			<div className="relative aspect-[4/3] overflow-hidden rounded-md bg-neutral-100 lg:aspect-auto">
				{image ? (
					<DirectusImage
						uuid={image}
						alt={post.title}
						fill
						priority
						sizes="(max-width: 1024px) 100vw, 44vw"
						className="object-cover transition duration-500 group-hover:scale-[1.02]"
					/>
				) : (
					<div className="flex h-full items-center justify-center bg-neutral-950 text-neutral-100">
						<span className="max-w-[12rem] text-center font-serif text-3xl leading-tight">{post.title}</span>
					</div>
				)}
			</div>
		</Link>
	);
}

function ArticleRow({ post }: { post: PostWithAuthor }) {
	const image = getPostImage(post);
	const authorAvatar = getAuthorAvatar(post.author);

	return (
		<article className="group grid grid-cols-[minmax(0,1fr)_96px] gap-5 border-b border-neutral-200 py-7 sm:grid-cols-[minmax(0,1fr)_156px]">
			<div>
				<div className="mb-3 flex items-center gap-2">
					{authorAvatar ? (
						<DirectusImage
							uuid={authorAvatar}
							alt={getAuthorName(post.author)}
							width={24}
							height={24}
							className="size-6 rounded-full object-cover"
						/>
					) : (
						<span className="flex size-6 items-center justify-center rounded-full bg-neutral-200">
							<UserRound className="size-3.5 text-neutral-600" />
						</span>
					)}
					<span className="text-sm text-neutral-700">{getAuthorName(post.author)}</span>
				</div>
				<Link href={getPostHref(post)}>
					<h2 className="font-serif text-2xl leading-tight text-neutral-950 transition-colors group-hover:text-emerald-800">
						{post.title}
					</h2>
					<p className="mt-2 line-clamp-2 text-base leading-7 text-neutral-600">{getPostExcerpt(post)}</p>
				</Link>
				<div className="mt-4 flex items-center justify-between gap-4">
					<PostMeta post={post} />
					<button
						type="button"
						aria-label={`Bookmark ${post.title}`}
						className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
					>
						<Bookmark className="size-4" />
					</button>
				</div>
			</div>
			<Link
				href={getPostHref(post)}
				className="relative aspect-square overflow-hidden rounded bg-neutral-100 sm:aspect-[4/3]"
			>
				{image ? (
					<DirectusImage
						uuid={image}
						alt={post.title}
						fill
						sizes="(max-width: 640px) 96px, 156px"
						className="object-cover transition duration-500 group-hover:scale-105"
					/>
				) : (
					<div className="h-full bg-[linear-gradient(135deg,#111827,#f5f5f4)]" />
				)}
			</Link>
		</article>
	);
}

function Sidebar({ posts }: { posts: PostWithAuthor[] }) {
	const authors = posts
		.map((post) => post.author)
		.filter((author): author is NonNullable<Post['author']> => Boolean(author))
		.filter((author, index, list) => {
			if (typeof author === 'string') return list.indexOf(author) === index;

			return list.findIndex((item) => typeof item !== 'string' && item.id === author.id) === index;
		})
		.slice(0, 3);

	return (
		<aside className="space-y-10 lg:sticky lg:top-24 lg:self-start">
			<section>
				<h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-neutral-950">Recommended Topics</h2>
				<div className="mt-4 flex flex-wrap gap-2">
					{topics.map((topic) => (
						<Link
							key={topic}
							href={`/?topic=${encodeURIComponent(topic)}`}
							className="rounded-full bg-neutral-100 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-950 hover:text-white"
						>
							{topic}
						</Link>
					))}
				</div>
			</section>

			<section>
				<h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-neutral-950">Who to Follow</h2>
				<div className="mt-5 space-y-5">
					{authors.length > 0 ? (
						authors.map((author) => {
							const avatar = getAuthorAvatar(author);

							return (
								<div key={typeof author === 'string' ? author : author.id} className="flex items-start gap-3">
									{avatar ? (
										<DirectusImage
											uuid={avatar}
											alt={getAuthorName(author)}
											width={40}
											height={40}
											className="size-10 rounded-full object-cover"
										/>
									) : (
										<span className="flex size-10 items-center justify-center rounded-full bg-neutral-200">
											<UserRound className="size-5 text-neutral-600" />
										</span>
									)}
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold text-neutral-950">{getAuthorName(author)}</p>
										{typeof author !== 'string' && author.description && (
											<p className="mt-1 line-clamp-2 text-sm leading-5 text-neutral-500">{author.description}</p>
										)}
									</div>
									<button
										type="button"
										className="rounded-full border border-neutral-900 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-neutral-950 hover:text-white"
									>
										Follow
									</button>
								</div>
							);
						})
					) : (
						<p className="text-sm leading-6 text-neutral-500">Authors will appear here once posts are published.</p>
					)}
				</div>
			</section>
		</aside>
	);
}

function EmptyHomeState() {
	return (
		<Container className="py-20">
			<div className="mx-auto max-w-2xl text-center">
				<div className="mx-auto flex size-12 items-center justify-center rounded-full bg-neutral-100">
					<Search className="size-5 text-neutral-500" />
				</div>
				<h1 className="mt-6 font-serif text-4xl text-neutral-950">No published posts yet</h1>
				<p className="mt-4 text-neutral-600">
					The homepage is ready. Publish posts in Directus and they will appear here automatically.
				</p>
			</div>
		</Container>
	);
}

export default function MediumHomePage({ posts, globals }: MediumHomePageProps) {
	if (!posts.length) return <EmptyHomeState />;

	const [featuredPost, ...rest] = posts;
	const trendingPosts = rest.slice(0, 3);
	const articlePosts = rest.slice(3);

	return (
		<div className="bg-white text-neutral-950">
			<Container className="py-8 sm:py-12">
				<div className="mb-8 flex flex-col gap-3 border-b border-neutral-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-sm font-medium uppercase tracking-[0.14em] text-emerald-800">
							{globals?.tagline || 'Thoughtful writing'}
						</p>
						<p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
							{globals?.description || 'Essays, ideas, and notes from the editorial desk.'}
						</p>
					</div>
					<Link href="#latest" className="text-sm font-medium text-neutral-950 underline-offset-4 hover:underline">
						Start reading
					</Link>
				</div>

				<FeaturedPost post={featuredPost} />

				{trendingPosts.length > 0 && (
					<section className="border-b border-neutral-200 py-8">
						<h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.12em] text-neutral-950">Trending</h2>
						<div className="grid gap-6 md:grid-cols-3">
							{trendingPosts.map((post, index) => (
								<Link key={post.id} href={getPostHref(post)} className="group flex gap-4">
									<span className="font-serif text-3xl leading-none text-neutral-300">
										{String(index + 1).padStart(2, '0')}
									</span>
									<div>
										<PostMeta post={post} />
										<h3 className="mt-2 text-base font-semibold leading-snug text-neutral-950 group-hover:text-emerald-800">
											{post.title}
										</h3>
									</div>
								</Link>
							))}
						</div>
					</section>
				)}

				<div id="latest" className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
					<section>
						<h2 className="sr-only">Latest posts</h2>
						{articlePosts.length > 0 ? (
							articlePosts.map((post) => <ArticleRow key={post.id} post={post} />)
						) : (
							<p className="py-8 text-neutral-500">More posts will appear here as your archive grows.</p>
						)}
					</section>
					<Sidebar posts={posts} />
				</div>
			</Container>
		</div>
	);
}

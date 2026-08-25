import { ChevronFirst, ChevronLast } from 'lucide-react';
import Link from 'next/link';

import Tagline from '@/components/ui/Tagline';
import Headline from '@/components/ui/Headline';
import DirectusImage from '@/components/shared/DirectusImage';
import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from '@/components/ui/pagination';
import { fetchTotalPostCount } from '@/lib/directus/fetchers';
import { visualEditingAttr } from '@/lib/directus/visual-editing-attributes';
import { getPostExcerpt, getPostImage } from '@/lib/posts';
import type { Post } from '@/types/directus-schema';

interface PostsProps {
	data: {
		id: string;
		tagline?: string;
		headline?: string;
		posts: Post[];
		limit: number;
	};
	currentPage?: number;
}

const VISIBLE_PAGES = 5;

function generatePagination(currentPage: number, totalPages: number) {
	const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];

	if (totalPages <= VISIBLE_PAGES) {
		for (let page = 1; page <= totalPages; page += 1) pages.push(page);

		return pages;
	}

	const rangeStart = Math.max(1, currentPage - 2);
	const rangeEnd = Math.min(totalPages, currentPage + 2);

	if (rangeStart > 1) pages.push('ellipsis-start');
	for (let page = rangeStart; page <= rangeEnd; page += 1) pages.push(page);
	if (rangeEnd < totalPages) pages.push('ellipsis-end');

	return pages;
}

const pageHref = (page: number) => `?page=${page}`;

export default async function Posts({ data, currentPage = 1 }: PostsProps) {
	const { tagline, headline, posts = [], limit, id } = data;
	const perPage = limit || 6;
	const totalCount = await fetchTotalPostCount();
	const totalPages = Math.ceil(totalCount / perPage);
	const paginationLinks = generatePagination(currentPage, totalPages);

	return (
		<div>
			{tagline && (
				<Tagline
					tagline={tagline}
					data-directus={visualEditingAttr({
						collection: 'block_posts',
						item: id,
						fields: 'tagline',
						mode: 'popover',
					})}
				/>
			)}
			{headline && (
				<Headline
					headline={headline}
					data-directus={visualEditingAttr({
						collection: 'block_posts',
						item: id,
						fields: 'headline',
						mode: 'popover',
					})}
				/>
			)}

			<div
				className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3"
				data-directus={visualEditingAttr({
					collection: 'block_posts',
					item: id,
					fields: ['collection', 'limit'],
					mode: 'popover',
				})}
			>
				{posts.length > 0 ? (
					posts.map((post) => {
						const image = getPostImage(post);

						return (
							<Link key={post.id} href={`/blog/${post.slug}`} className="group block overflow-hidden rounded-lg">
								<div className="relative h-64 w-full overflow-hidden rounded-lg">
									{image && (
										<DirectusImage
											uuid={image}
											alt={post.title || 'article image'}
											fill
											sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
											className="h-auto w-full rounded-lg object-cover transition-transform duration-300 group-hover:scale-110"
										/>
									)}
								</div>
								<div className="p-4">
									<h3 className="font-heading text-xl transition-colors duration-300 group-hover:text-accent">
										{post.title}
									</h3>
									{getPostExcerpt(post) && <p className="mt-2 text-sm text-foreground">{getPostExcerpt(post)}</p>}
								</div>
							</Link>
						);
					})
				) : (
					<p className="text-center text-gray-500">No posts available.</p>
				)}
			</div>

			{totalPages > 1 && (
				<Pagination className="mt-8">
					<PaginationContent>
						{currentPage > 1 && totalPages > VISIBLE_PAGES && (
							<PaginationItem>
								<PaginationLink href={pageHref(1)} aria-label="Go to first page">
									<ChevronFirst className="size-5" />
								</PaginationLink>
							</PaginationItem>
						)}
						{currentPage > 1 && (
							<PaginationItem>
								<PaginationPrevious href={pageHref(currentPage - 1)} />
							</PaginationItem>
						)}

						{paginationLinks.map((page) =>
							typeof page === 'number' ? (
								<PaginationItem key={page}>
									<PaginationLink href={pageHref(page)} isActive={currentPage === page}>
										{page}
									</PaginationLink>
								</PaginationItem>
							) : (
								<PaginationItem key={page}>
									<PaginationEllipsis />
								</PaginationItem>
							),
						)}

						{currentPage < totalPages && (
							<PaginationItem>
								<PaginationNext href={pageHref(currentPage + 1)} />
							</PaginationItem>
						)}
						{currentPage < totalPages && totalPages > VISIBLE_PAGES && (
							<PaginationItem>
								<PaginationLink href={pageHref(totalPages)} aria-label="Go to last page">
									<ChevronLast className="size-5" />
								</PaginationLink>
							</PaginationItem>
						)}
					</PaginationContent>
				</Pagination>
			)}
		</div>
	);
}

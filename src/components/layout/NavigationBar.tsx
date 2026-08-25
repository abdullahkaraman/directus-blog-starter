import Link from 'next/link';
import { Menu, PenLine } from 'lucide-react';

import SearchModal from '@/components/ui/SearchModal';
import Container from '@/components/ui/container';
import { visualEditingAttr } from '@/lib/directus/visual-editing-attributes';

type NavigationItem = {
	id: string;
	title?: string | null;
	url?: string | null;
	page?: { permalink?: string | null } | null;
};

interface NavigationBarProps {
	navigation?: {
		id: string;
		items?: unknown;
	} | null;
	globals?: {
		title?: string | null;
	} | null;
	publicWriteEnabled: boolean;
}

const getItemHref = (item: NavigationItem) => item.page?.permalink || item.url || '#';

export default function NavigationBar({ navigation, globals, publicWriteEnabled }: NavigationBarProps) {
	const siteTitle = globals?.title || 'Directus Blog';
	const items = Array.isArray(navigation?.items)
		? navigation.items.filter(
				(item): item is NavigationItem =>
					typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string',
			)
		: [];

	return (
		<header className="sticky top-0 z-[60] w-full border-b border-neutral-200 bg-white text-neutral-950">
			<Container className="flex h-16 items-center justify-between gap-4">
				<Link href="/" className="flex min-w-0 flex-shrink-0 items-center gap-3">
					<span className="font-serif text-2xl text-neutral-950">{siteTitle}</span>
				</Link>

				<nav className="flex min-w-0 items-center gap-3" aria-label="Primary navigation">
					<SearchModal variant="responsive" />

					<div
						className="hidden items-center gap-5 lg:flex"
						data-directus={
							navigation
								? visualEditingAttr({
										collection: 'navigation',
										item: navigation.id,
										fields: ['items'],
										mode: 'modal',
									})
								: undefined
						}
					>
						{items.map((item) => (
							<Link key={item.id} href={getItemHref(item)} className="text-sm text-neutral-600 hover:text-neutral-950">
								{item.title}
							</Link>
						))}
					</div>

					{publicWriteEnabled && (
						<Link
							href="/write"
							className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 sm:flex"
						>
							<PenLine className="size-4" />
							Write
						</Link>
					)}

					<details className="group relative lg:hidden">
						<summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-neutral-100 [&::-webkit-details-marker]:hidden">
							<Menu aria-hidden className="size-5" />
							<span className="sr-only">Open menu</span>
						</summary>
						<div className="absolute right-0 top-12 w-56 rounded-md border border-neutral-200 bg-white p-3 shadow-md">
							<div className="flex flex-col gap-4">
								{items.map((item) => (
									<Link key={item.id} href={getItemHref(item)} className="text-sm text-neutral-700">
										{item.title}
									</Link>
								))}
								{publicWriteEnabled && (
									<Link href="/write" className="flex items-center gap-2 text-sm text-neutral-700 sm:hidden">
										<PenLine className="size-4" />
										Write
									</Link>
								)}
							</div>
						</div>
					</details>
				</nav>
			</Container>
		</header>
	);
}

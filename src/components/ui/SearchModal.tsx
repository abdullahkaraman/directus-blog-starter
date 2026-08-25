'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';

const SearchDialog = dynamic(() => import('@/components/islands/SearchDialog.client'), { ssr: false });

type SearchModalProps = {
	variant?: 'icon' | 'bar' | 'responsive';
};

export default function SearchModal({ variant = 'icon' }: SearchModalProps) {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				setOpen((current) => !current);
			}
		};

		document.addEventListener('keydown', onKeyDown);

		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<div className="max-w-full sm:max-w-[540px]">
			{variant === 'bar' || variant === 'responsive' ? (
				<Button
					variant="ghost"
					onClick={() => setOpen(true)}
					aria-label="Search"
					className={`h-10 w-[180px] justify-start gap-2 rounded-full bg-neutral-100 px-4 text-sm font-normal text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800 sm:w-[260px] [&_svg]:text-neutral-500 ${variant === 'responsive' ? 'hidden sm:flex' : ''}`}
				>
					<Search className="size-4" />
					<span className="truncate">Search</span>
				</Button>
			) : null}
			{variant === 'icon' || variant === 'responsive' ? (
				<Button
					variant="ghost"
					size="icon"
					onClick={() => setOpen(true)}
					aria-label="Search"
					className={variant === 'responsive' ? 'sm:hidden' : undefined}
				>
					<Search className="size-5" />
				</Button>
			) : null}
			{open ? <SearchDialog onClose={() => setOpen(false)} /> : null}
		</div>
	);
}

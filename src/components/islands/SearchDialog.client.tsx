'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';

type SearchResult = {
	id: string;
	title: string;
	description: string;
	type: string;
	link: string;
};

interface SearchDialogProps {
	onClose: () => void;
}

export default function SearchDialog({ onClose }: SearchDialogProps) {
	const router = useRouter();
	const [results, setResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [searched, setSearched] = useState(false);
	const requestSequence = useRef(0);
	const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timeout.current) clearTimeout(timeout.current);
			requestSequence.current += 1;
		},
		[],
	);

	const handleSearch = (search: string) => {
		if (timeout.current) clearTimeout(timeout.current);
		const requestId = ++requestSequence.current;

		if (search.length < 3) {
			setResults([]);
			setSearched(false);
			setLoading(false);

			return;
		}

		setLoading(true);
		setSearched(true);
		timeout.current = setTimeout(async () => {
			try {
				const response = await fetch(`/api/search?search=${encodeURIComponent(search)}`);
				if (!response.ok) throw new Error('Failed to fetch results');

				const data = (await response.json()) as SearchResult[];
				if (requestId === requestSequence.current) setResults(data.filter((result) => result.link));
			} catch (error) {
				console.error('Error fetching search results:', error);
				if (requestId === requestSequence.current) setResults([]);
			} finally {
				if (requestId === requestSequence.current) setLoading(false);
			}
		}, 300);
	};

	return (
		<CommandDialog open onOpenChange={(open) => !open && onClose()}>
			<DialogTitle className="sr-only p-2">Search</DialogTitle>
			<DialogDescription className="sr-only px-2">Search for pages or posts</DialogDescription>
			<CommandInput
				placeholder="Search for pages or posts"
				onValueChange={handleSearch}
				className="m-2 p-4 text-base leading-normal focus:outline-none"
			/>
			<CommandList className="max-h-[500px] overflow-auto p-2 text-foreground">
				{!loading && !searched && (
					<CommandEmpty className="py-2 text-center text-sm">Enter a search term above to see results</CommandEmpty>
				)}
				{loading && <CommandEmpty className="py-2 text-center text-sm">Loading...</CommandEmpty>}
				{!loading && searched && results.length === 0 && (
					<CommandEmpty className="py-2 text-center text-sm">No results found</CommandEmpty>
				)}
				{!loading && results.length > 0 && (
					<CommandGroup heading="Search Results" className="pt-2" forceMount>
						{results.map((result) => (
							<CommandItem
								key={result.id}
								className="flex items-start gap-4 px-2 py-3"
								onSelect={() => {
									router.push(result.link);
									onClose();
								}}
							>
								<Badge variant="default">{result.type}</Badge>
								<div className="ml-2 w-full">
									<p className="text-base font-medium">{result.title}</p>
									{result.description && <p className="mt-1 line-clamp-2 text-sm">{result.description}</p>}
								</div>
							</CommandItem>
						))}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	);
}

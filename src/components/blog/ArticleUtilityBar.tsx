'use client';

import { useState } from 'react';
import { Bookmark, Clapperboard, Copy, Share2 } from 'lucide-react';

type ArticleUtilityBarProps = {
	postTitle: string;
	postUrl: string;
};

export default function ArticleUtilityBar({ postTitle, postUrl }: ArticleUtilityBarProps) {
	const [claps, setClaps] = useState(0);
	const [bookmarked, setBookmarked] = useState(false);
	const [copied, setCopied] = useState(false);

	const copyLink = async () => {
		await navigator.clipboard.writeText(postUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
	};

	const share = async () => {
		if (navigator.share) {
			await navigator.share({ title: postTitle, url: postUrl });

			return;
		}

		await copyLink();
	};

	return (
		<div className="mx-auto my-8 flex w-full max-w-2xl items-center justify-between border-y border-neutral-200 py-3 text-neutral-500 lg:fixed lg:left-[max(2rem,calc((100vw-42rem)/2-5.5rem))] lg:top-40 lg:mx-0 lg:w-14 lg:flex-col lg:gap-3 lg:rounded-full lg:border lg:bg-white lg:px-2 lg:py-4 lg:shadow-sm">
			<button
				type="button"
				onClick={() => setClaps((value) => value + 1)}
				className="flex items-center gap-2 rounded-full px-3 py-2 text-sm hover:bg-neutral-100 hover:text-neutral-950 lg:flex-col lg:gap-1"
				aria-label="Clap for this post"
			>
				<Clapperboard className="size-5" />
				<span>{claps}</span>
			</button>
			<button
				type="button"
				onClick={() => setBookmarked((value) => !value)}
				className="rounded-full px-3 py-2 hover:bg-neutral-100 hover:text-neutral-950"
				aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this post'}
			>
				<Bookmark className={`size-5 ${bookmarked ? 'fill-neutral-950 text-neutral-950' : ''}`} />
			</button>
			<button
				type="button"
				onClick={share}
				className="rounded-full px-3 py-2 hover:bg-neutral-100 hover:text-neutral-950"
				aria-label="Share this post"
			>
				<Share2 className="size-5" />
			</button>
			<button
				type="button"
				onClick={copyLink}
				className="relative rounded-full px-3 py-2 hover:bg-neutral-100 hover:text-neutral-950"
				aria-label="Copy post link"
			>
				<Copy className="size-5" />
				{copied && (
					<span className="absolute -top-8 left-1/2 hidden -translate-x-1/2 rounded bg-neutral-950 px-2 py-1 text-xs text-white lg:block">
						Copied
					</span>
				)}
			</button>
		</div>
	);
}

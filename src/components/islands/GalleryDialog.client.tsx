'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

import DirectusImage from '@/components/shared/DirectusImage';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export type GalleryDialogItem = {
	alt: string;
	id: string;
	directus_file: string;
};

interface GalleryDialogProps {
	initialIndex: number;
	items: GalleryDialogItem[];
	onClose: () => void;
}

export default function GalleryDialog({ initialIndex, items, onClose }: GalleryDialogProps) {
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const currentItem = items[currentIndex];

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'ArrowLeft') {
				setCurrentIndex((current) => (current === 0 ? items.length - 1 : current - 1));
			}
			if (event.key === 'ArrowRight') {
				setCurrentIndex((current) => (current === items.length - 1 ? 0 : current + 1));
			}
		};

		window.addEventListener('keydown', handleKeyDown);

		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [items.length]);

	if (!currentItem) return null;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="z-50 flex max-h-full max-w-full items-center justify-center border-none bg-transparent p-2"
				hideCloseButton
			>
				<DialogTitle className="sr-only">Gallery Image</DialogTitle>
				<DialogDescription className="sr-only">
					Viewing image {currentIndex + 1} of {items.length}.
				</DialogDescription>
				<div className="relative flex h-[90vh] w-[90vw] items-center justify-center">
					<DirectusImage
						uuid={currentItem.directus_file}
						alt={currentItem.alt}
						width={1200}
						height={800}
						className="size-full object-contain"
					/>
				</div>
				<div className="absolute inset-x-0 bottom-4 flex items-center justify-between px-4">
					<button
						type="button"
						className="flex items-center gap-2 rounded-full bg-black bg-opacity-70 px-4 py-2 text-white hover:bg-opacity-90"
						onClick={() => setCurrentIndex((current) => (current === 0 ? items.length - 1 : current - 1))}
						aria-label="Previous"
					>
						<ArrowLeft className="size-8" />
						<span>Prev</span>
					</button>
					<button
						type="button"
						className="flex items-center gap-2 rounded-full bg-black bg-opacity-70 px-4 py-2 text-white hover:bg-opacity-90"
						onClick={() => setCurrentIndex((current) => (current === items.length - 1 ? 0 : current + 1))}
						aria-label="Next"
					>
						<span>Next</span>
						<ArrowRight className="size-8" />
					</button>
				</div>
				<DialogClose asChild>
					<button
						type="button"
						className="absolute right-4 top-4 rounded-full bg-black bg-opacity-70 p-2 text-white hover:bg-opacity-90"
						aria-label="Close"
					>
						<X className="size-8" />
					</button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}

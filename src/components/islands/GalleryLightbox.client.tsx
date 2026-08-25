'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';

import type { GalleryDialogItem } from '@/components/islands/GalleryDialog.client';

const GalleryDialog = dynamic(() => import('@/components/islands/GalleryDialog.client'), { ssr: false });

interface GalleryLightboxProps {
	children: ReactNode;
	items: GalleryDialogItem[];
}

export default function GalleryLightbox({ children, items }: GalleryLightboxProps) {
	const [currentIndex, setCurrentIndex] = useState<number | null>(null);

	const handleGridClick = (event: MouseEvent<HTMLDivElement>) => {
		const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-gallery-index]');
		if (!trigger) return;

		const index = Number.parseInt(trigger.dataset.galleryIndex || '', 10);
		if (Number.isSafeInteger(index) && index >= 0 && index < items.length) setCurrentIndex(index);
	};

	return (
		<>
			<div onClick={handleGridClick}>{children}</div>
			{currentIndex === null ? null : (
				<GalleryDialog initialIndex={currentIndex} items={items} onClose={() => setCurrentIndex(null)} />
			)}
		</>
	);
}

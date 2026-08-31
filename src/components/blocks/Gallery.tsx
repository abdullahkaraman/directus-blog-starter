import { ZoomIn } from 'lucide-react';

import DirectusImage from '@/components/shared/DirectusImage';
import GalleryLightbox from '@/components/islands/GalleryLightbox.client';
import Tagline from '@/components/ui/Tagline';
import Headline from '@/components/ui/Headline';
import { visualEditingAttr } from '@/lib/directus/visual-editing-attributes';

interface GalleryItem {
	id: string;
	directus_file: { description?: string | null; id: string; title?: string | null } | string;
	sort?: number;
}

interface GalleryData {
	id: string;
	tagline?: string;
	headline?: string;
	items?: GalleryItem[];
}

interface GalleryProps {
	data: GalleryData;
}

export default function Gallery({ data }: GalleryProps) {
	const { tagline, headline, items, id } = data;
	const sortedItems = items?.toSorted((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) ?? [];
	const galleryItems = sortedItems.flatMap((item, index) => {
		const file = typeof item.directus_file === 'string' ? { id: item.directus_file } : item.directus_file;
		if (!file?.id) return [];

		return [
			{
				alt: file.description?.trim() || file.title?.trim() || `${headline || 'Gallery image'} ${index + 1}`,
				directus_file: file.id,
				id: item.id,
			},
		];
	});

	return (
		<section className="relative">
			{tagline && (
				<Tagline
					tagline={tagline}
					data-directus={visualEditingAttr({
						collection: 'block_gallery',
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
						collection: 'block_gallery',
						item: id,
						fields: 'headline',
						mode: 'popover',
					})}
				/>
			)}

			{galleryItems.length > 0 && (
				<GalleryLightbox items={galleryItems}>
					<div
						className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3"
						data-directus={visualEditingAttr({
							collection: 'block_gallery',
							item: id,
							fields: 'items',
							mode: 'modal',
						})}
					>
						{galleryItems.map((item, index) => (
							<button
								type="button"
								key={item.id}
								data-gallery-index={index}
								className="group relative h-[300px] overflow-hidden rounded-lg text-left transition-shadow duration-300 hover:shadow-lg"
								aria-label={`Open gallery item ${index + 1}`}
							>
								<DirectusImage
									uuid={item.directus_file}
									alt={item.alt}
									fill
									sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
									className="h-auto w-full rounded-lg object-cover"
								/>
								<div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
									<ZoomIn className="size-10 text-gray-800" />
								</div>
							</button>
						))}
					</div>
				</GalleryLightbox>
			)}
		</section>
	);
}

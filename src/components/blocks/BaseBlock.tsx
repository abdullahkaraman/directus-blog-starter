import RichText from '@/components/blocks/RichText';
import Hero from '@/components/blocks/Hero';
import Gallery from '@/components/blocks/Gallery';
import Pricing from '@/components/blocks/Pricing';
import Posts from '@/components/blocks/Posts';
import Form from '@/components/blocks/Form';

interface BaseBlockProps {
	block: {
		collection: string;
		item: any;
		id: string;
	};
	currentPage?: number;
}

export default function BaseBlock({ block, currentPage }: BaseBlockProps) {
	const itemId = block.item?.id;
	const sharedProps = { data: block.item, blockId: block.id, itemId };

	switch (block.collection) {
		case 'block_hero':
			return <Hero {...sharedProps} />;
		case 'block_richtext':
			return <RichText {...sharedProps} />;
		case 'block_gallery':
			return <Gallery {...sharedProps} />;
		case 'block_pricing':
			return <Pricing {...sharedProps} />;
		case 'block_posts':
			return <Posts {...sharedProps} currentPage={currentPage} />;
		case 'block_form':
			return <Form {...sharedProps} />;
		default:
			return null;
	}
}

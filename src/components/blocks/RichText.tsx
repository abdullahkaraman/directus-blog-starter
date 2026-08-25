import { cn } from '@/lib/utils';
import Tagline from '@/components/ui/Tagline';
import Headline from '@/components/ui/Headline';
import Text from '@/components/ui/Text';
import { visualEditingAttr } from '@/lib/directus/visual-editing-attributes';

interface RichTextProps {
	data: {
		id: string;
		tagline?: string;
		headline?: string;
		content?: string;
		alignment?: 'left' | 'center' | 'right';
	};
	className?: string;
}

const RichText = ({ data, className }: RichTextProps) => {
	const { id, tagline, headline, content, alignment = 'left' } = data;

	return (
		<div
			className={cn(
				'mx-auto max-w-[600px] space-y-6',
				alignment === 'center' ? 'text-center' : alignment === 'right' ? 'text-right' : 'text-left',
				className,
			)}
		>
			{tagline && (
				<Tagline
					tagline={tagline}
					data-directus={visualEditingAttr({
						collection: 'block_richtext',
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
						collection: 'block_richtext',
						item: id,
						fields: 'headline',
						mode: 'popover',
					})}
				/>
			)}
			{content && (
				<Text
					content={content}
					data-directus={visualEditingAttr({
						collection: 'block_richtext',
						item: id,
						fields: 'content',
						mode: 'drawer',
					})}
				/>
			)}
		</div>
	);
};

export default RichText;

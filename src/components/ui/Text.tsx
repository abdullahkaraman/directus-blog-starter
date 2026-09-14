import { sanitizeHtml } from '@/lib/sanitize-html.server';
import { cn } from '@/lib/utils';

export interface TextProps {
	content: string;
	className?: string;
	'data-directus'?: string;
}

const Text = ({ content, className, 'data-directus': dataDirectus }: TextProps) => {
	return (
		<div
			className={cn(
				'prose font-sans prose-p:font-sans prose-li:font-sans prose-headings:font-serif prose-headings:font-normal dark:prose-invert',
				className,
			)}
			dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
			data-directus={dataDirectus}
		/>
	);
};

export default Text;

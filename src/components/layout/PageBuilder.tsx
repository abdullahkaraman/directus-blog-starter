import { PageBlock } from '@/types/directus-schema';
import BaseBlock from '@/components/blocks/BaseBlock';
import Container from '@/components/ui/container';

interface PageBuilderProps {
	sections: PageBlock[];
	currentPage?: number;
}

const PageBuilder = ({ sections, currentPage }: PageBuilderProps) => {
	const validBlocks = sections.filter(
		(block): block is PageBlock & { collection: string; item: object } =>
			typeof block.collection === 'string' && !!block.item && typeof block.item === 'object',
	);

	return (
		<div>
			{validBlocks.map((block) => (
				<div key={block.id} data-background={block.background} className="py-16">
					<Container>
						<BaseBlock
							block={{
								collection: block.collection,
								item: block.item,
								id: block.id,
							}}
							currentPage={currentPage}
						/>
					</Container>
				</div>
			))}
		</div>
	);
};

export default PageBuilder;

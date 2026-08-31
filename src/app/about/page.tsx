import InfoPage from '@/components/content/InfoPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	description: 'Learn about this site and the people who publish it.',
	title: 'About',
};

export default function AboutPage() {
	return (
		<InfoPage
			eyebrow="About this site"
			title="About"
			description="Introduce the people, perspective, and purpose behind your publication."
			summary="Replace the starter language with accurate information about your organisation or author."
			sections={[
				{ title: 'What you publish', content: 'Explain the subjects, formats, and audience this site serves.' },
				{
					title: 'How you work',
					content: 'Describe your editorial process, expertise, and the standards readers should expect.',
				},
			]}
		/>
	);
}

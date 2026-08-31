import InfoPage from '@/components/content/InfoPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	description: 'Terms governing access to and use of this site.',
	title: 'Terms',
};

export default function TermsPage() {
	return (
		<InfoPage
			eyebrow="Legal information"
			title="Terms"
			description="Set the expectations that govern access to and use of your site."
			summary="Replace this template with terms that match your content, services, jurisdiction, and user submissions."
			sections={[
				{
					title: 'Content use',
					content: 'State what visitors may quote, share, or reuse, and how attribution should work.',
				},
				{
					title: 'Responsibility',
					content: 'Clarify that editorial content is not professional advice where that distinction matters.',
				},
				{
					title: 'External links',
					content: 'Explain that third-party sites have their own content and privacy practices.',
				},
			]}
		/>
	);
}

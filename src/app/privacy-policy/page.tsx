import InfoPage from '@/components/content/InfoPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	description: 'How this site handles information, cookies, and third-party services.',
	title: 'Privacy',
};

export default function PrivacyPolicyPage() {
	return (
		<InfoPage
			eyebrow="Legal information"
			title="Privacy"
			description="Explain how your site handles information, cookies, and third-party services."
			summary="This is starter copy, not legal advice. Replace it with a policy that reflects your actual operations and jurisdiction."
			sections={[
				{
					title: 'Information you collect',
					content: 'List form fields, analytics data, and any other information processed by the site.',
				},
				{
					title: 'Services you use',
					content: 'Name your hosting, content platform, analytics, and message-delivery providers.',
				},
				{
					title: 'Consent and choices',
					content: 'Describe consent, retention, and contact options required for your use case.',
				},
			]}
		/>
	);
}

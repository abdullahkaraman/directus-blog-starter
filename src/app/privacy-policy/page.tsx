import Container from '@/components/ui/container';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	description: 'How this site handles information, cookies, and third-party services.',
	title: 'Privacy',
};

export default function PrivacyPolicyPage() {
	return (
		<Container className="max-w-3xl py-16 sm:py-24">
			<article className="prose prose-lg max-w-none">
				<h1>Privacy</h1>
				<p>
					This is starter copy. Replace it with a policy that accurately reflects your forms, analytics, hosting,
					content platform, and applicable law.
				</p>
				<p>Do not enable analytics until your privacy notice and consent flow, where required, are ready.</p>
			</article>
		</Container>
	);
}

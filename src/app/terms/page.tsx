import Container from '@/components/ui/container';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	description: 'Terms governing access to and use of this site.',
	title: 'Terms',
};

export default function TermsPage() {
	return (
		<Container className="max-w-3xl py-16 sm:py-24">
			<article className="prose prose-lg max-w-none">
				<h1>Terms</h1>
				<p>
					This is starter copy. Replace it with terms that fit your content, services, jurisdiction, and any user
					submissions before publishing.
				</p>
				<p>Do not present general template text as legal advice; obtain appropriate review for your use case.</p>
			</article>
		</Container>
	);
}

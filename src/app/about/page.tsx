import Container from '@/components/ui/container';
import type { Metadata } from 'next';

export const metadata: Metadata = {
	description: 'Learn about this site and the people who publish it.',
	title: 'About',
};

export default function AboutPage() {
	return (
		<Container className="max-w-3xl py-16 sm:py-24">
			<article className="prose prose-lg max-w-none">
				<h1>About</h1>
				<p>Use this page to explain who publishes the site, what readers can expect, and how you approach your work.</p>
				<p>Before publishing, replace this starter copy with accurate information about your organisation or author.</p>
			</article>
		</Container>
	);
}

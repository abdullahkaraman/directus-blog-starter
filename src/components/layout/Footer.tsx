import Container from '@/components/ui/container';
import Link from 'next/link';

interface FooterProps {
	navigation?: unknown;
	globals?: {
		title?: string | null;
	};
}

export default function Footer({ globals }: FooterProps) {
	const siteTitle = globals?.title || 'Directus Blog';

	return (
		<footer className="border-t border-neutral-200 bg-white py-8 text-neutral-500">
			<Container className="flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between">
				<p>
					© {new Date().getFullYear()} {siteTitle}
				</p>
				<nav aria-label="Footer navigation">
					<ul className="flex flex-wrap gap-x-5 gap-y-2">
						{[
							{ href: '/about', label: 'About' },
							{ href: '/privacy-policy', label: 'Privacy' },
							{ href: '/terms', label: 'Terms' },
						].map((link) => (
							<li key={link.href}>
								<Link href={link.href} className="hover:text-neutral-950">
									{link.label}
								</Link>
							</li>
						))}
					</ul>
				</nav>
			</Container>
		</footer>
	);
}

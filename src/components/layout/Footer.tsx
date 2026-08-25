import Container from '@/components/ui/container';

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
			</Container>
		</footer>
	);
}

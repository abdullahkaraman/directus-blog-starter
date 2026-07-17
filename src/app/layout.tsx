import '@/styles/globals.css';
import '@/styles/fonts.css';
import { ReactNode } from 'react';
import { Metadata } from 'next';

import VisualEditingLayout from '@/components/layout/VisualEditingLayout';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { fetchSiteData } from '@/lib/directus/fetchers';
import { getDirectusAssetURL } from '@/lib/directus/directus-utils';

export async function generateMetadata(): Promise<Metadata> {
	const { globals } = await fetchSiteData();

	const siteTitle = globals?.title || 'Directus Blog';
	const siteDescription = globals?.description || 'A blog powered by Next.js and Directus.';
	const faviconURL = globals?.favicon ? getDirectusAssetURL(globals.favicon) : '/favicon.ico';

	return {
		title: {
			default: siteTitle,
			template: siteTitle,
		},
		description: siteDescription,
		icons: {
			icon: faviconURL,
		},
	};
}

export default async function RootLayout({ children }: { children: ReactNode }) {
	const { globals, headerNavigation, footerNavigation } = await fetchSiteData();
	const accentColor = globals?.accent_color || '#6644ff';

	return (
		<html lang="en" style={{ '--accent-color': accentColor } as React.CSSProperties} suppressHydrationWarning>
			<body className="antialiased font-sans flex flex-col min-h-screen">
				<ThemeProvider>
					<VisualEditingLayout
						headerNavigation={headerNavigation}
						footerNavigation={footerNavigation}
						globals={globals}
						publicWriteEnabled={process.env.ENABLE_PUBLIC_WRITE === 'true'}
					>
						<main className="flex-grow">{children}</main>
					</VisualEditingLayout>
				</ThemeProvider>
			</body>
		</html>
	);
}

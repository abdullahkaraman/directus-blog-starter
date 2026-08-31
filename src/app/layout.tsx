import '@/styles/globals.css';
import '@/styles/fonts.css';
import { ReactNode } from 'react';
import { Metadata } from 'next';

import NavigationBar from '@/components/layout/NavigationBar';
import Footer from '@/components/layout/Footer';
import GoogleAnalytics from '@/components/seo/GoogleAnalytics';
import VisualEditingBridge from '@/components/islands/VisualEditingBridge.client';
import { fetchSiteData } from '@/lib/directus/fetchers';
import { getDirectusAssetURL } from '@/lib/directus/directus-utils';

export async function generateMetadata(): Promise<Metadata> {
	const { globals } = await fetchSiteData();

	const siteTitle = globals?.title || 'Directus Blog';
	const siteDescription = globals?.description || 'A blog powered by Next.js and Directus.';
	const faviconURL = globals?.favicon ? getDirectusAssetURL(globals.favicon) : '/favicon.ico';
	const googleSiteVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

	return {
		title: {
			default: siteTitle,
			template: siteTitle,
		},
		description: siteDescription,
		icons: {
			icon: faviconURL,
		},
		verification: { google: googleSiteVerification || undefined },
	};
}

export default async function RootLayout({ children }: { children: ReactNode }) {
	const { globals, headerNavigation, footerNavigation } = await fetchSiteData();
	const visualEditingEnabled = process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING === 'true';
	const directusUrl = process.env.NEXT_PUBLIC_DIRECTUS_URL?.trim();

	return (
		<html lang="en">
			<body className="antialiased font-sans flex flex-col min-h-screen">
				<NavigationBar
					navigation={headerNavigation}
					globals={globals}
					publicWriteEnabled={process.env.ENABLE_PUBLIC_WRITE === 'true'}
				/>
				<main className="flex-grow">{children}</main>
				<Footer navigation={footerNavigation} globals={globals} />
				<GoogleAnalytics />
				{visualEditingEnabled && directusUrl ? <VisualEditingBridge directusUrl={directusUrl} /> : null}
			</body>
		</html>
	);
}

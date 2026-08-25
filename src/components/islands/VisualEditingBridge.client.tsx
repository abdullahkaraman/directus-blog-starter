'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface VisualEditingBridgeProps {
	directusUrl: string;
}

export default function VisualEditingBridge({ directusUrl }: VisualEditingBridgeProps) {
	const router = useRouter();
	const pathname = usePathname();

	useEffect(() => {
		if (!pathname.startsWith('/preview/')) return;

		let cancelled = false;
		let removeOverlays: (() => void) | undefined;

		const enableVisualEditing = async () => {
			const { apply } = await import('@directus/visual-editing');
			if (cancelled) return;

			const controller = await apply({
				directusUrl,
				onSaved: () => router.refresh(),
			});

			removeOverlays = controller?.remove;
		};

		void enableVisualEditing();

		return () => {
			cancelled = true;
			removeOverlays?.();
		};
	}, [directusUrl, pathname, router]);

	return null;
}

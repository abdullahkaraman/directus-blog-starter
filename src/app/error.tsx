'use client';

import { RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import Container from '@/components/ui/container';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<Container className="py-20">
			<div className="mx-auto max-w-xl text-center">
				<h1 className="font-serif text-4xl text-neutral-950">Something went wrong</h1>
				<p className="mt-4 text-neutral-600">
					The page could not be loaded right now. Try again, or check the Directus API permissions for this content.
				</p>
				<Button type="button" onClick={reset} className="mt-8 gap-2 rounded-full">
					<RefreshCcw className="size-4" />
					Try again
				</Button>
			</div>
		</Container>
	);
}

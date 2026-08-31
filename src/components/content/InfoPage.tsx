import type { ReactNode } from 'react';

import Container from '@/components/ui/container';

type InfoPageSection = {
	content: ReactNode;
	title: string;
};

interface InfoPageProps {
	description: string;
	eyebrow: string;
	sections: InfoPageSection[];
	summary: string;
	title: string;
}

export default function InfoPage({ description, eyebrow, sections, summary, title }: InfoPageProps) {
	return (
		<Container className="max-w-5xl py-16 sm:py-24">
			<header className="max-w-3xl">
				<p className="flex items-center gap-3 text-sm font-medium uppercase tracking-[0.16em] text-[var(--accent-color)]">
					<span className="h-px w-10 bg-current" aria-hidden="true" />
					{eyebrow}
				</p>
				<h1 className="mt-6 text-balance font-serif text-5xl leading-[1.02] tracking-normal text-neutral-950 dark:text-neutral-50 sm:text-6xl lg:text-7xl">
					{title}
				</h1>
				<p className="mt-6 text-xl leading-8 text-neutral-600 dark:text-neutral-300">{description}</p>
			</header>

			<div className="mt-14 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-20">
				<aside className="h-fit border-y border-neutral-200 py-5 text-sm leading-6 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300 lg:sticky lg:top-28">
					<p className="font-semibold uppercase tracking-[0.14em] text-neutral-950 dark:text-neutral-50">
						Before you publish
					</p>
					<p className="mt-3">{summary}</p>
				</aside>
				<div className="divide-y divide-neutral-200 border-y border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
					{sections.map((section, index) => (
						<section key={section.title} className="py-8 sm:py-10">
							<p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent-color)]">
								{String(index + 1).padStart(2, '0')}
							</p>
							<h2 className="mt-3 font-serif text-3xl text-neutral-950 dark:text-neutral-50">{section.title}</h2>
							<div className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">{section.content}</div>
						</section>
					))}
				</div>
			</div>
		</Container>
	);
}

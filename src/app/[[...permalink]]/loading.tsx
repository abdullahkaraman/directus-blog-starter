import Container from '@/components/ui/container';

function SkeletonLine({ className = '' }: { className?: string }) {
	return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

export default function Loading() {
	return (
		<div className="bg-white text-neutral-950">
			<Container className="py-8 sm:py-12">
				<div className="mb-8 border-b border-neutral-200 pb-6">
					<SkeletonLine className="h-3 w-36" />
					<SkeletonLine className="mt-4 h-4 w-full max-w-lg" />
				</div>

				<div className="grid gap-6 border-b border-neutral-200 pb-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
					<div className="flex min-h-[360px] flex-col justify-end">
						<SkeletonLine className="h-6 w-32" />
						<SkeletonLine className="mt-5 h-16 w-full max-w-2xl" />
						<SkeletonLine className="mt-3 h-16 w-full max-w-xl" />
						<SkeletonLine className="mt-6 h-5 w-full max-w-lg" />
					</div>
					<SkeletonLine className="aspect-[4/3] w-full lg:aspect-auto" />
				</div>

				<div className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
					<section>
						{[0, 1, 2].map((item) => (
							<div
								key={item}
								className="grid grid-cols-[minmax(0,1fr)_96px] gap-5 border-b border-neutral-200 py-7 sm:grid-cols-[minmax(0,1fr)_156px]"
							>
								<div>
									<SkeletonLine className="h-5 w-32" />
									<SkeletonLine className="mt-4 h-7 w-full max-w-lg" />
									<SkeletonLine className="mt-3 h-4 w-full max-w-xl" />
									<SkeletonLine className="mt-2 h-4 w-3/4" />
								</div>
								<SkeletonLine className="aspect-square sm:aspect-[4/3]" />
							</div>
						))}
					</section>
					<aside className="hidden space-y-4 lg:block">
						<SkeletonLine className="h-4 w-44" />
						<div className="flex flex-wrap gap-2">
							{[0, 1, 2, 3, 4].map((item) => (
								<SkeletonLine key={item} className="h-9 w-24 rounded-full" />
							))}
						</div>
					</aside>
				</div>
			</Container>
		</div>
	);
}

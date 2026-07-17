import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-0 ring-offset-0 transition-colors focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				default: 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 hover:text-neutral-950',
				destructive: 'bg-red-600 text-white hover:bg-red-500',
				outline: 'border border-neutral-300 text-neutral-800 hover:border-neutral-800 hover:text-neutral-950',
				secondary: 'bg-blue text-white hover:bg-blue-800 dark:bg-accent',
				ghost: 'bg-transparent text-gray-900 hover:bg-background-muted dark:text-white',
				link: 'text-neutral-700 underline-offset-4 hover:text-neutral-950 dark:text-gray-500',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-9 rounded-md px-3',
				lg: 'h-11 rounded-md px-8',
				icon: 'size-10 p-0',
			},
			block: {
				true: 'w-full',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
	block?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, block = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button';

		return <Comp className={cn(buttonVariants({ variant, size, className, block }))} ref={ref} {...props} />;
	},
);
Button.displayName = 'Button';

export { Button, buttonVariants };

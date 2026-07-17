'use client';

import { FormField } from '@/types/directus-schema';
import FormBuilder from '../forms/FormBuilder';
import { setAttr } from '@directus/visual-editing';

interface FormBlockProps {
	data: {
		id: string;
		tagline: string | null;
		headline: string | null;
		form: {
			id: string;
			on_success?: 'redirect' | 'message' | null;
			sort?: number | null;
			submit_label?: string;
			success_message?: string | null;
			title?: string | null;
			success_redirect_url?: string | null;
			is_active?: boolean | null;
			fields: FormField[];
		};
	};
	itemId?: string;
	blockId?: string;
}

const FormBlock = ({ data }: FormBlockProps) => {
	const { tagline, headline, form } = data;

	if (!form) {
		return null;
	}

	return (
		<section className="mx-auto max-w-xl bg-white px-6 py-16 text-center text-neutral-900 sm:py-24">
			{tagline && (
				<p
					className="mx-auto max-w-lg text-base leading-7 text-neutral-500"
					data-directus={setAttr({
						collection: 'block_form',
						item: data.id,
						fields: 'tagline',
						mode: 'popover',
					})}
				>
					{tagline}
				</p>
			)}

			{headline && (
				<h1
					className="font-serif text-5xl leading-tight text-neutral-950"
					data-directus={setAttr({
						collection: 'block_form',
						item: data.id,
						fields: 'headline',
						mode: 'popover',
					})}
				>
					{headline}
				</h1>
			)}

			<div
				className="text-left"
				data-directus={setAttr({
					collection: 'block_form',
					item: data.id,
					fields: ['form'],
					mode: 'popover',
				})}
			>
				<FormBuilder form={form} className="mt-8" />
			</div>
		</section>
	);
};

export default FormBlock;

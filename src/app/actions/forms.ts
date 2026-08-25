'use server';

import { submitForm } from '@/lib/directus/forms';

export async function submitFormAction(formId: string, data: Record<string, unknown>) {
	await submitForm(formId, data);
}

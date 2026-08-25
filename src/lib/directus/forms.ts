import 'server-only';

import { getDirectus, getDirectusServerToken } from './directus';
import type { Form, FormField, FormSubmission, FormSubmissionValue } from '@/types/directus-schema';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set([
	'application/pdf',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
	'text/plain',
]);

export const submitForm = async (formId: string, data: Record<string, unknown>) => {
	const { directus, readItem, uploadFiles, createItem, withToken } = getDirectus();
	const token = getDirectusServerToken();

	try {
		const form = (await directus.request(
			withToken(
				token,
				readItem('forms', formId, {
					fields: ['id', 'is_active', { fields: ['id', 'name', 'type'] }],
				}),
			),
		)) as Pick<Form, 'id' | 'is_active'> & { fields?: FormField[] | string[] | null };

		if (!form.is_active) throw new Error('Form is not active');

		const fields = (Array.isArray(form.fields) ? form.fields : []).filter(
			(field): field is FormField => typeof field === 'object' && field !== null,
		);
		const submissionValues = (
			await Promise.all(
				fields.map(async (field): Promise<Omit<FormSubmissionValue, 'id'> | null> => {
					if (!field.name || !field.type) return null;

					const value = data[field.name];

					if (value === undefined || value === null) return null;

					if (field.type === 'file' && value instanceof File) {
						if (value.size > MAX_UPLOAD_BYTES) {
							throw new Error('File is too large');
						}

						if (value.type && !ALLOWED_UPLOAD_TYPES.has(value.type)) {
							throw new Error('File type is not allowed');
						}

						const formData = new FormData();
						formData.append('file', value);

						const uploadedFile = await directus.request(withToken(token, uploadFiles(formData)));

						if (!uploadedFile || !('id' in uploadedFile)) return null;

						return {
							field: String(field.id),
							file: uploadedFile.id,
						};
					}

					return {
						field: String(field.id),
						value: value.toString(),
					};
				}),
			)
		).filter((value): value is Omit<FormSubmissionValue, 'id'> => value !== null);

		const payload = {
			form: formId,
			values: submissionValues,
		};

		await directus.request(withToken(token, createItem('form_submissions', payload as Omit<FormSubmission, 'id'>)));
	} catch (error) {
		console.error('Error submitting form:', error);
		throw new Error('Failed to submit form');
	}
};

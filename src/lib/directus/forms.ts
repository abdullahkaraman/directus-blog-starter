import { getDirectusServerToken, useDirectus } from './directus';
import type { FormSubmission, FormSubmissionValue } from '@/types/directus-schema';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set([
	'application/pdf',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
	'text/plain',
]);

export const submitForm = async (
	formId: string,
	fields: { id: string; name: string; type: string }[],
	data: Record<string, any>,
) => {
	const { directus, uploadFiles, createItem, withToken } = useDirectus();
	const token = getDirectusServerToken();

	try {
		const submissionValues: Omit<FormSubmissionValue, 'id'>[] = [];

		for (const field of fields) {
			const value = data[field.name];

			if (value === undefined || value === null) continue;

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

				if (uploadedFile && 'id' in uploadedFile) {
					submissionValues.push({
						field: field.id,
						file: uploadedFile.id,
					});
				}
			} else {
				submissionValues.push({
					field: field.id,
					value: value.toString(),
				});
			}
		}

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

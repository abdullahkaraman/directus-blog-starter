import 'server-only';

import { timingSafeEqual } from 'node:crypto';

export function isValidPreviewToken(
	providedToken: string | null | undefined,
	expectedToken = process.env.DRAFT_PREVIEW_SECRET,
) {
	if (!providedToken || !expectedToken) return false;

	const provided = Buffer.from(providedToken);
	const expected = Buffer.from(expectedToken);

	return provided.length === expected.length && timingSafeEqual(provided, expected);
}

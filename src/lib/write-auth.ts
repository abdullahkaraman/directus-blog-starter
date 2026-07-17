import { headers } from 'next/headers';

import { verifyWriteAuthorization } from '@/lib/write-auth-core';

export async function auth() {
	const requestHeaders = await headers();

	return verifyWriteAuthorization(requestHeaders.get('authorization'));
}

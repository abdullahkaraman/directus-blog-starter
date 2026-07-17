import { NextResponse, type NextRequest } from 'next/server';

import { isWriteAuthConfigured, verifyWriteAuthorization } from '@/lib/write-auth-core';

const blockedProbePaths = [
	/^\/\.env(?:\/.*)?$/,
	/^\/\.git(?:\/.*)?$/,
	/^\/wp-login\.php$/,
	/^\/wp-admin(?:\/.*)?$/,
	/^\/xmlrpc\.php$/,
	/^\/api$/,
	/^\/api\/health$/,
];

export async function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (blockedProbePaths.some((pattern) => pattern.test(pathname))) {
		return NextResponse.json(
			{ error: 'not found' },
			{
				status: 404,
				headers: {
					'Cache-Control': 'public, max-age=300',
					'X-Robots-Tag': 'noindex',
				},
			},
		);
	}
	if (pathname === '/write' || pathname.startsWith('/write/')) {
		if (process.env.ENABLE_PUBLIC_WRITE !== 'true') {
			return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
		}
		if (!isWriteAuthConfigured()) {
			return new NextResponse('Write access is not configured.', {
				status: 503,
				headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
			});
		}

		const session = await verifyWriteAuthorization(request.headers.get('authorization'));

		if (!session) {
			return new NextResponse('Authentication required.', {
				status: 401,
				headers: {
					'Cache-Control': 'no-store',
					'WWW-Authenticate': 'Basic realm="Directus Blog writer", charset="UTF-8"',
					'X-Robots-Tag': 'noindex',
				},
			});
		}
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		'/.env/:path*',
		'/.git/:path*',
		'/wp-login.php',
		'/wp-admin/:path*',
		'/xmlrpc.php',
		'/api',
		'/api/health',
		'/write/:path*',
	],
};

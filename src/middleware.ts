import { NextResponse, type NextRequest } from 'next/server';

const blockedProbePaths = [
	/^\/\.env(?:\/.*)?$/,
	/^\/\.git(?:\/.*)?$/,
	/^\/wp-login\.php$/,
	/^\/wp-admin(?:\/.*)?$/,
	/^\/xmlrpc\.php$/,
	/^\/api$/,
	/^\/api\/health$/,
];

export function middleware(request: NextRequest) {
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

	return NextResponse.next();
}

export const config = {
	matcher: ['/.env/:path*', '/.git/:path*', '/wp-login.php', '/wp-admin/:path*', '/xmlrpc.php', '/api', '/api/health'],
};

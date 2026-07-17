export type WriteSession = {
	user: {
		name: string;
	};
};

const textEncoder = new TextEncoder();
const MIN_WRITE_PASSWORD_LENGTH = 16;

function getWriteCredentials() {
	return {
		password: process.env.WRITE_ACCESS_PASSWORD?.trim() ?? '',
		username: process.env.WRITE_ACCESS_USERNAME?.trim() || 'writer',
	};
}

async function secureEqual(value: string, expected: string) {
	const [valueHash, expectedHash] = await Promise.all([
		crypto.subtle.digest('SHA-256', textEncoder.encode(value)),
		crypto.subtle.digest('SHA-256', textEncoder.encode(expected)),
	]);
	const valueBytes = new Uint8Array(valueHash);
	const expectedBytes = new Uint8Array(expectedHash);
	let difference = 0;

	for (let index = 0; index < valueBytes.length; index += 1) {
		difference |= valueBytes[index] ^ expectedBytes[index];
	}

	return difference === 0;
}

export function isWriteAuthConfigured() {
	return getWriteCredentials().password.length >= MIN_WRITE_PASSWORD_LENGTH;
}

export async function verifyWriteAuthorization(authorization: string | null): Promise<WriteSession | null> {
	const { password: expectedPassword, username: expectedUsername } = getWriteCredentials();
	const match = authorization?.match(/^Basic\s+(.+)$/i);

	if (expectedPassword.length < MIN_WRITE_PASSWORD_LENGTH || !match) return null;

	let decodedCredentials: string;

	try {
		decodedCredentials = atob(match[1]);
	} catch {
		return null;
	}

	const separatorIndex = decodedCredentials.indexOf(':');
	if (separatorIndex < 0) return null;

	const username = decodedCredentials.slice(0, separatorIndex);
	const password = decodedCredentials.slice(separatorIndex + 1);
	const [usernameMatches, passwordMatches] = await Promise.all([
		secureEqual(username, expectedUsername),
		secureEqual(password, expectedPassword),
	]);

	return usernameMatches && passwordMatches ? { user: { name: expectedUsername } } : null;
}

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { isWriteAuthConfigured, verifyWriteAuthorization } from '../src/lib/write-auth-core';

const originalUsername = process.env.WRITE_ACCESS_USERNAME;
const originalPassword = process.env.WRITE_ACCESS_PASSWORD;

afterEach(() => {
	process.env.WRITE_ACCESS_USERNAME = originalUsername;
	process.env.WRITE_ACCESS_PASSWORD = originalPassword;
});

test('write authentication requires a password of at least 16 characters', async () => {
	process.env.WRITE_ACCESS_USERNAME = 'writer';
	process.env.WRITE_ACCESS_PASSWORD = 'too-short';

	assert.equal(isWriteAuthConfigured(), false);
	assert.equal(await verifyWriteAuthorization('Basic ' + btoa('writer:too-short')), null);
});

test('write authentication accepts matching Basic credentials', async () => {
	process.env.WRITE_ACCESS_USERNAME = 'editor';
	process.env.WRITE_ACCESS_PASSWORD = 'a-long-random-password';

	assert.equal(isWriteAuthConfigured(), true);
	assert.deepEqual(await verifyWriteAuthorization('Basic ' + btoa('editor:a-long-random-password')), {
		user: { name: 'editor' },
	});
});

test('write authentication rejects malformed and incorrect credentials', async () => {
	process.env.WRITE_ACCESS_USERNAME = 'writer';
	process.env.WRITE_ACCESS_PASSWORD = 'a-long-random-password';

	assert.equal(await verifyWriteAuthorization(null), null);
	assert.equal(await verifyWriteAuthorization('Bearer token'), null);
	assert.equal(await verifyWriteAuthorization('Basic not-base64!'), null);
	assert.equal(await verifyWriteAuthorization('Basic ' + btoa('writer:wrong-password-value')), null);
});

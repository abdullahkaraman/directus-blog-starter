import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidPreviewToken } from '../src/lib/preview-auth';

test('preview authorization accepts the dedicated secret', () => {
	assert.equal(isValidPreviewToken('preview-secret', 'preview-secret'), true);
});

test('preview authorization rejects missing and incorrect secrets', () => {
	assert.equal(isValidPreviewToken(null, 'preview-secret'), false);
	assert.equal(isValidPreviewToken('preview-secret', undefined), false);
	assert.equal(isValidPreviewToken('wrong-secret', 'preview-secret'), false);
	assert.equal(isValidPreviewToken('short', 'longer-secret'), false);
});

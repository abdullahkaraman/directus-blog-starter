import assert from 'node:assert/strict';
import test from 'node:test';

import { parseJobRequest } from '../src/submission.mjs';

test('parseJobRequest recognizes publish commands with Turkish or ASCII spelling', () => {
	const id = 'bb549ac3-1710-4e7e-930b-76cac45c7685';
	assert.equal(parseJobRequest(`/yayinla ${id}`).targetJobId, id);
	assert.equal(parseJobRequest(`/yayınla ${id}`).type, 'publish');
});

test('parseJobRequest rejects malformed publish commands', () => {
	assert.throws(() => parseJobRequest('/yayinla'), /tek bir değer gerekli/);
	assert.throws(() => parseJobRequest('/yayinla yanlış-id'), /Geçerli bir iş numarası/);
});

test('parseJobRequest preserves idea and article routing', () => {
	assert.equal(parseJobRequest('/fikir agent runtime').type, 'ideas');
	assert.equal(parseJobRequest('Agent runtime hakkında yaz.').type, 'article');
});

test('parseJobRequest recognizes edit commands with an instruction', () => {
	const id = 'bb549ac3-1710-4e7e-930b-76cac45c7685';
	assert.equal(parseJobRequest(`/edit ${id} Tonu daha sıcak yap.`).prompt, 'Tonu daha sıcak yap.');
	assert.throws(() => parseJobRequest(`/edit ${id}`), /gerekli alanları eksik/);
});

test('parseJobRequest recognizes status commands and rejects malformed usage', () => {
	const id = 'bb549ac3-1710-4e7e-930b-76cac45c7685';
	assert.equal(parseJobRequest(`/durum ${id}`).targetJobId, id);
	assert.throws(() => parseJobRequest('/durum'), /tek bir değer gerekli/);
	assert.throws(() => parseJobRequest('/durum yanlış-id'), /Geçerli bir iş numarası/);
});

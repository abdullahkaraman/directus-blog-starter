import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublishedPageSearchFilter, createPublishedPostSearchFilter } from '../src/lib/directus/search-filters';

test('page search always requires published status', () => {
	assert.deepEqual(createPublishedPageSearchFilter('directus'), {
		status: { _eq: 'published' },
		_or: [{ title: { _contains: 'directus' } }, { permalink: { _contains: 'directus' } }],
	});
});

test('post search always requires published status', () => {
	assert.deepEqual(createPublishedPostSearchFilter('directus'), {
		status: { _eq: 'published' },
		_or: [
			{ title: { _contains: 'directus' } },
			{ description: { _contains: 'directus' } },
			{ slug: { _contains: 'directus' } },
		],
	});
});

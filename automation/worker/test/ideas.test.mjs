import assert from 'node:assert/strict';
import test from 'node:test';

import { validateIdeas } from '../src/ideas.mjs';

function idea(index) {
	return {
		title: `Farklı yazı fikri ${index}`,
		hook: `Okurun ${index}. gerçek problemini yakalayan giriş.`,
		angle: `Konuyu ${index}. özgün açıdan ele alır.`,
		whyNow: `Güncel gelişme ${index} nedeniyle şimdi anlamlı.`,
		outline: ['Teori', 'Gerçek örnek', 'Uygulama'],
	};
}

test('validateIdeas accepts five distinct researched options', () => {
	const result = validateIdeas({
		theme: 'Yapay zekâ ajanları',
		researchSummary: 'Güncel gelişmeler doğrulama ve runtime çevresinde yoğunlaşıyor.',
		options: Array.from({ length: 5 }, (_, index) => idea(index + 1)),
		sources: [{ title: 'Kaynak', url: 'https://example.com' }],
	});

	assert.equal(result.options.length, 5);
	assert.equal(result.sources.length, 1);
});

test('validateIdeas rejects too few usable options', () => {
	assert.throws(
		() => validateIdeas({ options: Array.from({ length: 4 }, (_, index) => idea(index + 1)) }),
		/too few usable editorial ideas/,
	);
});

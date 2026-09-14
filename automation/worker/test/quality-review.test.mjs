import assert from 'node:assert/strict';
import test from 'node:test';

import { validateQualityReview } from '../src/quality-review.mjs';

test('quality review accepts a consistent pass verdict', () => {
	const review = validateQualityReview({
		verdict: 'pass',
		summary: 'Yazı yayın standardını karşılıyor.',
		issues: [{ severity: 'minor', criterion: 'Dil', evidence: 'Bir uzun cümle.', instruction: 'Kısaltılabilir.' }],
		revisionInstructions: '',
	});

	assert.equal(review.verdict, 'pass');
});

test('quality review rejects contradictory pass verdicts', () => {
	assert.throws(
		() =>
			validateQualityReview({
				verdict: 'pass',
				summary: 'Eksikler var.',
				issues: [{ severity: 'major', criterion: 'Derinlik', evidence: 'Sığ.', instruction: 'Derinleştir.' }],
				revisionInstructions: '',
			}),
		/conflicts/,
	);
	assert.throws(
		() =>
			validateQualityReview({
				verdict: 'revise',
				summary: 'Düzeltme gerekli.',
				issues: [{ severity: 'major', criterion: 'Örnek', evidence: 'Eksik.', instruction: 'Örnek ekle.' }],
				revisionInstructions: '',
			}),
		/without instructions/,
	);
});

test('quality review requires blockers for reject decisions', () => {
	assert.throws(
		() =>
			validateQualityReview({
				verdict: 'reject',
				summary: 'Teslim reddedildi.',
				issues: [{ severity: 'major', criterion: 'Uyum', evidence: 'Zayıf.', instruction: 'Düzelt.' }],
				revisionInstructions: '',
			}),
		/requires a blocker/,
	);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicationLearningContext, validateLearningResult } from '../src/learning.mjs';

test('learning results allow none or one bounded proposal', () => {
	assert.deepEqual(validateLearningResult({ outcome: 'none', reason: 'Genellenebilir sinyal yok.', proposal: null }), {
		outcome: 'none',
		reason: 'Genellenebilir sinyal yok.',
		proposal: null,
	});
	assert.equal(
		validateLearningResult({
			outcome: 'proposal',
			reason: 'Açık edit tercihi.',
			proposal: { text: 'Tonu sıcak tut.', rationale: 'Kullanıcı istedi.', evidence: ['Edit talimatı'] },
		}).proposal.text,
		'Tonu sıcak tut.',
	);
	assert.throws(
		() =>
			validateLearningResult({
				outcome: 'proposal',
				reason: 'Uzun',
				proposal: { text: 'a'.repeat(501), rationale: 'Neden', evidence: [] },
			}),
		/cannot exceed 500/,
	);
});

test('learning context contains edit instructions and final content without unrelated jobs', () => {
	const owner = { telegramChatId: '1', telegramUserId: '2' };
	const source = { id: 'source', ...owner, type: 'article', createdAt: '2026-01-01', result: { postId: 'post-1' } };
	const edit = {
		id: 'edit',
		...owner,
		type: 'edit',
		targetJobId: source.id,
		prompt: 'Tonu sıcak yap.',
		createdAt: '2026-01-02',
		result: { postId: 'post-1', quality: { summary: 'Geçti', issues: [] } },
	};
	const publication = { id: 'publish', ...owner, type: 'publish', createdAt: '2026-01-03', result: {} };
	const context = buildPublicationLearningContext({
		jobs: [source, edit, publication, { id: 'other', createdAt: '2026-01-04' }],
		publicationJob: publication,
		sourceJob: source,
		finalArticle: { title: 'Yazı', content: '<p>İçerik</p>' },
		memorySnapshot: { hash: 'abc', content: '' },
	});
	assert.equal(context.revisionChain.find((job) => job.jobId === 'edit').explicitEditInstruction, 'Tonu sıcak yap.');
	assert.equal(context.revisionChain.some((job) => job.jobId === 'other'), false);
	assert.equal(context.finalArticle.content, '<p>İçerik</p>');
});

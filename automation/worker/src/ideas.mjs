import { stripHtml } from './article.mjs';

export function validateIdeas(raw) {
	if (!raw || typeof raw !== 'object') throw new Error('Codex did not return an idea research object.');
	const options = Array.isArray(raw.options)
		? raw.options
				.flatMap((option) => {
					const sanitizedOption = {
						title: stripHtml(String(option?.title || '')).slice(0, 180),
						hook: stripHtml(String(option?.hook || '')).slice(0, 350),
						angle: stripHtml(String(option?.angle || '')).slice(0, 350),
						whyNow: stripHtml(String(option?.whyNow || '')).slice(0, 350),
						outline: Array.isArray(option?.outline)
							? option.outline
									.flatMap((item) => {
										const sanitizedItem = stripHtml(String(item));

										return sanitizedItem ? [sanitizedItem] : [];
									})
									.slice(0, 6)
							: [],
					};
					const isUsable =
						sanitizedOption.title &&
						sanitizedOption.hook &&
						sanitizedOption.angle &&
						sanitizedOption.whyNow &&
						sanitizedOption.outline.length >= 3;

					return isUsable ? [sanitizedOption] : [];
				})
				.slice(0, 7)
		: [];
	if (options.length < 5) throw new Error(`Codex returned too few usable editorial ideas (${options.length}/5).`);
	if (new Set(options.map((option) => option.title.toLocaleLowerCase('tr-TR'))).size !== options.length) {
		throw new Error('Codex returned duplicate editorial ideas.');
	}

	const sources = Array.isArray(raw.sources)
		? raw.sources
				.flatMap((source) => {
					const sanitizedSource = {
						title: stripHtml(String(source?.title || '')).slice(0, 200),
						url: String(source?.url || '').trim(),
					};

					return sanitizedSource.title && /^https?:\/\//.test(sanitizedSource.url) ? [sanitizedSource] : [];
				})
				.slice(0, 30)
		: [];

	return {
		theme: stripHtml(String(raw.theme || '')).slice(0, 200),
		researchSummary: stripHtml(String(raw.researchSummary || '')).slice(0, 800),
		options,
		sources,
	};
}

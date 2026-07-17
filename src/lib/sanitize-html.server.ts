import sanitizeHtmlLibrary from 'sanitize-html';

const allowedTags = sanitizeHtmlLibrary.defaults.allowedTags.concat(['figure', 'figcaption', 'img']);

function isExternalHttpLink(href?: string) {
	if (!href) return false;

	try {
		const linkUrl = new URL(href);

		if (!['http:', 'https:'].includes(linkUrl.protocol)) return false;

		const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

		return !siteUrl || linkUrl.origin !== new URL(siteUrl).origin;
	} catch {
		return false;
	}
}

function getSafeRel(rel?: string) {
	return [...new Set([...(rel?.split(/\s+/).filter(Boolean) ?? []), 'noopener', 'noreferrer'])].join(' ');
}

export function sanitizeHtml(html: string) {
	return sanitizeHtmlLibrary(html, {
		allowedTags,
		allowedAttributes: {
			...sanitizeHtmlLibrary.defaults.allowedAttributes,
			a: ['href', 'name', 'rel', 'target'],
			blockquote: ['class'],
			img: [
				'alt',
				'data-directus-file',
				'data-legacy-image',
				'decoding',
				'height',
				'loading',
				'src',
				'srcset',
				'title',
				'width',
			],
		},
		allowedSchemes: ['http', 'https', 'mailto', 'tel'],
		allowProtocolRelative: false,
		transformTags: {
			a: (_tagName, attributes) => {
				const opensInNewTab = attributes.target === '_blank' || isExternalHttpLink(attributes.href);

				return {
					tagName: 'a',
					attribs: {
						...attributes,
						...(opensInNewTab ? { rel: getSafeRel(attributes.rel), target: '_blank' } : {}),
					},
				};
			},
		},
	});
}

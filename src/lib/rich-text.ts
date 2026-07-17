const escapeHtml = (value: unknown) =>
	String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

export function editorJsToHtml(content: unknown) {
	if (!content || typeof content !== 'object' || !('blocks' in content) || !Array.isArray(content.blocks)) {
		return typeof content === 'string' ? content : '';
	}

	return content.blocks
		.map((block: any) => {
			if (block.type === 'header') {
				const level = Math.min(Math.max(Number(block.data?.level) || 2, 2), 4);

				return `<h${level}>${escapeHtml(block.data?.text)}</h${level}>`;
			}

			if (block.type === 'list' && Array.isArray(block.data?.items)) {
				const tag = block.data?.style === 'ordered' ? 'ol' : 'ul';
				const items = block.data.items.map((item: string) => `<li>${escapeHtml(item)}</li>`).join('');

				return `<${tag}>${items}</${tag}>`;
			}

			if (block.type === 'quote') {
				return `<blockquote>${escapeHtml(block.data?.text)}</blockquote>`;
			}

			if (block.type === 'code') {
				return `<pre><code>${escapeHtml(block.data?.code)}</code></pre>`;
			}

			if (block.type === 'paragraph') {
				return `<p>${escapeHtml(block.data?.text)}</p>`;
			}

			return '';
		})
		.join('');
}

export function sanitizeHtml(html: string) {
	return html
		.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
		.replace(/\son\w+=(["']).*?\1/gi, '')
		.replace(/\s(href|src)=(["'])javascript:[\s\S]*?\2/gi, '');
}

export function renderRichText(content: unknown) {
	return sanitizeHtml(editorJsToHtml(content));
}

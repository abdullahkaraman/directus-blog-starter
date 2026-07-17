export const createPublishedPageSearchFilter = (search: string) => ({
	status: { _eq: 'published' },
	_or: [{ title: { _contains: search } }, { permalink: { _contains: search } }],
});

export const createPublishedPostSearchFilter = (search: string) => ({
	status: { _eq: 'published' },
	_or: [{ title: { _contains: search } }, { description: { _contains: search } }, { slug: { _contains: search } }],
});

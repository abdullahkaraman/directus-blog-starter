type VisualEditingAttribute = {
	collection: string;
	item: string | number;
	fields: string | string[];
	mode?: 'popover' | 'modal' | 'drawer';
};

export function visualEditingAttr({ collection, item, fields, mode }: VisualEditingAttribute) {
	if (process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING !== 'true') return undefined;

	const fieldList = Array.isArray(fields) ? fields.join(',') : fields;

	return [`collection:${collection}`, `item:${item}`, `fields:${fieldList}`, ...(mode ? [`mode:${mode}`] : [])].join(
		';',
	);
}

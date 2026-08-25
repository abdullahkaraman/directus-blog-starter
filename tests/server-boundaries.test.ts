import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { visualEditingAttr } from '../src/lib/directus/visual-editing-attributes';

const repositoryRoot = process.cwd();
const sourceRoot = path.join(repositoryRoot, 'src');

async function sourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const entryPath = path.join(directory, entry.name);

			if (entry.isDirectory()) return sourceFiles(entryPath);
			if (/\.(ts|tsx)$/.test(entry.name)) return [entryPath];

			return [];
		}),
	);

	return nested.flat();
}

test('private Directus modules are marked server-only', async () => {
	const privateModules = [
		'src/lib/directus/directus.ts',
		'src/lib/directus/fetchers.ts',
		'src/lib/directus/forms.ts',
		'src/lib/preview-auth.ts',
		'src/lib/sanitize-html.server.ts',
	];

	for (const modulePath of privateModules) {
		const source = await readFile(path.join(repositoryRoot, modulePath), 'utf8');
		assert.match(source, /^import 'server-only';/m, `${modulePath} must remain server-only`);
	}
});

test('client components do not import private server modules', async () => {
	const forbiddenImports = [
		'@/lib/directus/directus',
		'@/lib/directus/fetchers',
		'@/lib/directus/forms',
		'@/lib/preview-auth',
		'@/lib/sanitize-html.server',
	];

	for (const filePath of await sourceFiles(sourceRoot)) {
		const source = await readFile(filePath, 'utf8');
		if (!/^['"]use client['"];?/m.test(source)) continue;

		for (const forbiddenImport of forbiddenImports) {
			assert.doesNotMatch(
				source,
				new RegExp(`from ['"]${forbiddenImport.replaceAll('/', '\\/')}['"]`),
				`${path.relative(repositoryRoot, filePath)} imports ${forbiddenImport}`,
			);
		}
	}
});

test('visual editing annotations are opt-in', () => {
	const previousValue = process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING;

	try {
		delete process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING;
		assert.equal(visualEditingAttr({ collection: 'pages', item: 'page-id', fields: 'title' }), undefined);

		process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING = 'true';
		assert.equal(
			visualEditingAttr({ collection: 'pages', item: 'page-id', fields: ['title', 'blocks'], mode: 'modal' }),
			'collection:pages;item:page-id;fields:title,blocks;mode:modal',
		);
	} finally {
		if (previousValue === undefined) delete process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING;
		else process.env.NEXT_PUBLIC_ENABLE_VISUAL_EDITING = previousValue;
	}
});

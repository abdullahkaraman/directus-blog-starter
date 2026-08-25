import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

type AppBuildManifest = {
	pages: Record<string, string[]>;
};

const buildRoot = path.join(process.cwd(), '.next');
const routes = ['/[[...permalink]]/page', '/blog/[slug]/page'];
const forbiddenMarkers = [
	'@directus/sdk',
	'@directus/visual-editing',
	'DIRECTUS_SERVER_TOKEN',
	'cmdk',
	'react-hook-form',
];
const maximumInitialGzipBytes = 140 * 1024;

async function main() {
	const manifest = JSON.parse(
		await readFile(path.join(buildRoot, 'app-build-manifest.json'), 'utf8'),
	) as AppBuildManifest;
	const layoutFiles = manifest.pages['/layout'];

	if (!layoutFiles) throw new Error('Root layout is missing from the app build manifest');

	for (const route of routes) {
		const routeFiles = manifest.pages[route];
		if (!routeFiles) throw new Error(`${route} is missing from the app build manifest`);

		const initialJavaScript = [...new Set([...layoutFiles, ...routeFiles])].filter((file) => file.endsWith('.js'));
		let gzipBytes = 0;

		for (const relativeFile of initialJavaScript) {
			const absoluteFile = path.join(buildRoot, relativeFile);
			const source = await readFile(absoluteFile);
			gzipBytes += gzipSync(source).byteLength;

			const sourceText = source.toString('utf8');
			for (const marker of forbiddenMarkers) {
				if (sourceText.includes(marker)) {
					throw new Error(`${route} initial JavaScript contains forbidden marker ${marker} in ${relativeFile}`);
				}
			}
		}

		if (gzipBytes > maximumInitialGzipBytes) {
			throw new Error(`${route} initial JavaScript is ${gzipBytes} gzip bytes; budget is ${maximumInitialGzipBytes}`);
		}

		console.log(`${route}: ${gzipBytes} gzip bytes, ${initialJavaScript.length} initial chunks`);
	}
}

void main();

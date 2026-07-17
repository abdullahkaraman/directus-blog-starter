import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	createDirectus,
	rest,
	schemaApply,
	schemaDiff,
	schemaSnapshot,
	staticToken,
	type SchemaDiffOutput,
	type SchemaSnapshotOutput,
} from '@directus/sdk';
import { config } from 'dotenv';

const DEFAULT_SNAPSHOT_PATH = resolve(process.cwd(), 'directus/snapshot.json');
const PRIVATE_COLLECTIONS = new Set(['ai_prompts']);
const PRIVATE_FIELDS = new Map([
	['globals', new Set(['directus_url', 'meta_credentials', 'meta_notice_security', 'openai_api_key'])],
]);

export type Snapshot = SchemaSnapshotOutput & {
	systemFields?: Record<string, unknown>[];
};

export interface SchemaAdapter {
	snapshot(): Promise<Snapshot>;
	diff(snapshot: Snapshot): Promise<SchemaDiffOutput | null>;
	apply(diff: SchemaDiffOutput): Promise<void>;
}

export interface CommandOptions {
	apply: boolean;
	allowDestructive: boolean;
	pull: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(entry: Record<string, unknown>, key: string): string | undefined {
	return typeof entry[key] === 'string' ? entry[key] : undefined;
}

export function parseCommandOptions(args: string[]): CommandOptions {
	const knownOptions = new Set(['--allow-destructive', '--apply', '--pull']);
	const unknownOption = args.find((arg) => !knownOptions.has(arg));

	if (unknownOption) {
		throw new Error('Unknown option: ' + unknownOption);
	}

	const options = {
		apply: args.includes('--apply'),
		allowDestructive: args.includes('--allow-destructive'),
		pull: args.includes('--pull'),
	};

	if (options.apply && options.pull) {
		throw new Error('--apply and --pull cannot be used together.');
	}
	if (options.allowDestructive && !options.apply) {
		throw new Error('--allow-destructive requires --apply.');
	}

	return options;
}

export function sanitizeSnapshot(input: unknown): Snapshot {
	assert.ok(isRecord(input), 'Snapshot must be a JSON object.');
	const version = input.version;
	const directus = input.directus;
	const vendor = input.vendor;
	if (typeof version !== 'number') throw new Error('Snapshot version is missing.');
	if (typeof directus !== 'string') throw new Error('Snapshot Directus version is missing.');
	if (typeof vendor !== 'string') throw new Error('Snapshot database vendor is missing.');
	assert.ok(Array.isArray(input.collections), 'Snapshot collections must be an array.');
	assert.ok(Array.isArray(input.fields), 'Snapshot fields must be an array.');
	assert.ok(Array.isArray(input.relations), 'Snapshot relations must be an array.');
	assert.ok(
		input.systemFields === undefined || Array.isArray(input.systemFields),
		'Snapshot system fields must be an array.',
	);

	const collections = input.collections.filter((entry) => {
		return isRecord(entry) && !PRIVATE_COLLECTIONS.has(readString(entry, 'collection') ?? '');
	});
	const fields = input.fields.filter((entry) => {
		if (!isRecord(entry)) return false;

		const collection = readString(entry, 'collection') ?? '';
		const field = readString(entry, 'field') ?? '';
		return !PRIVATE_COLLECTIONS.has(collection) && !PRIVATE_FIELDS.get(collection)?.has(field);
	});
	const relations = input.relations.filter((entry) => {
		if (!isRecord(entry)) return false;

		const collection = readString(entry, 'collection') ?? '';
		const relatedCollection = readString(entry, 'related_collection') ?? '';
		return !PRIVATE_COLLECTIONS.has(collection) && !PRIVATE_COLLECTIONS.has(relatedCollection);
	});

	assert.ok(collections.length > 0, 'Refusing to use a snapshot without collections.');
	assert.ok(fields.length > 0, 'Refusing to use a snapshot without fields.');

	return structuredClone({
		version,
		directus,
		vendor,
		collections,
		fields,
		relations,
		...(input.systemFields === undefined ? {} : { systemFields: input.systemFields }),
	});
}

function countChanges(value: unknown): number {
	if (Array.isArray(value)) return value.length;
	if (!isRecord(value)) return value === undefined || value === null ? 0 : 1;

	const nestedArrays = Object.values(value).filter(Array.isArray);
	if (nestedArrays.length > 0) {
		return nestedArrays.reduce((total, entries) => total + entries.length, 0);
	}

	return Object.keys(value).length;
}

export function formatDiffSummary(result: SchemaDiffOutput): string {
	const diff = isRecord(result.diff) ? result.diff : {};
	return ['collections', 'fields', 'relations']
		.map((section) => section + '=' + countChanges(diff[section]))
		.join(', ');
}

export function countDeletionOperations(value: unknown): number {
	if (Array.isArray(value)) {
		return value.reduce((total, entry) => total + countDeletionOperations(entry), 0);
	}
	if (!isRecord(value)) return 0;
	if (value.kind === 'D') return 1;

	return Object.values(value).reduce<number>((total, entry) => total + countDeletionOperations(entry), 0);
}

export async function applySnapshot(
	snapshot: Snapshot,
	applyRequested: boolean,
	adapter: SchemaAdapter,
	allowDestructive = false,
): Promise<'applied' | 'dry-run' | 'unchanged'> {
	const result = await adapter.diff(snapshot);
	if (!result || !isRecord(result.diff) || Object.keys(result.diff).length === 0) {
		console.log('Directus schema is already in sync.');
		return 'unchanged';
	}

	console.log('Schema differences: ' + formatDiffSummary(result));
	const deletionCount = countDeletionOperations(result.diff);
	if (deletionCount > 0) {
		console.log('Warning: this diff includes ' + deletionCount + ' deletion operation(s).');
	}
	if (!applyRequested) {
		console.log('Dry run only. Run pnpm directus:setup:apply to apply these changes.');
		return 'dry-run';
	}
	if (deletionCount > 0 && !allowDestructive) {
		throw new Error(
			'Refusing to apply a diff with deletions. Review a backup, then rerun with --apply --allow-destructive.',
		);
	}

	await adapter.apply(result);
	console.log('Directus schema applied.');
	return 'applied';
}

export function createSchemaAdapter(url: string, token: string): SchemaAdapter {
	const client = createDirectus(url).with(staticToken(token)).with(rest());

	return {
		snapshot: () => client.request(schemaSnapshot()),
		diff: (snapshot) => client.request(schemaDiff(snapshot)),
		apply: (diff) => client.request(schemaApply(diff)),
	};
}

export async function runCommand(
	args: string[],
	env: NodeJS.ProcessEnv = process.env,
	snapshotPath = DEFAULT_SNAPSHOT_PATH,
): Promise<void> {
	const options = parseCommandOptions(args);
	const url = env.NEXT_PUBLIC_DIRECTUS_URL?.trim();
	const token = env.DIRECTUS_ADMIN_TOKEN?.trim();

	if (!url) throw new Error('NEXT_PUBLIC_DIRECTUS_URL is required.');
	if (!token) throw new Error('DIRECTUS_ADMIN_TOKEN is required.');

	const adapter = createSchemaAdapter(url, token);
	if (options.pull) {
		const snapshot = sanitizeSnapshot(await adapter.snapshot());
		mkdirSync(dirname(snapshotPath), { recursive: true });
		writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
		console.log(
			'Sanitized snapshot saved: ' +
				snapshot.collections.length +
				' collections, ' +
				snapshot.fields.length +
				' fields, ' +
				snapshot.relations.length +
				' relations.',
		);
		return;
	}

	const snapshot = sanitizeSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')) as unknown);
	await applySnapshot(snapshot, options.apply, adapter, options.allowDestructive);
}

async function main(): Promise<void> {
	config();
	await runCommand(process.argv.slice(2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	main().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error('Directus schema command failed: ' + message);
		process.exitCode = 1;
	});
}

import {
	createDirectus,
	readItems,
	readItem,
	readSingleton,
	rest,
	readUser,
	createItem,
	updateItem,
	uploadFiles,
	withToken,
} from '@directus/sdk';
import type { RestClient } from '@directus/sdk';
import Queue from 'p-queue';
import type { Schema } from '@/types/directus-schema';

// Helper for retrying fetch requests
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DIRECTUS_REVALIDATE_SECONDS = 300;

type NextFetchInit = RequestInit & {
	next?: {
		revalidate?: number | false;
		tags?: string[];
	};
};

const getRequestMethod = (input: RequestInfo | URL, init?: RequestInit) => {
	if (init?.method) return init.method.toUpperCase();
	if (input instanceof Request) return input.method.toUpperCase();

	return 'GET';
};

const withDirectusCache = (input: RequestInfo | URL, init?: RequestInit): Parameters<typeof fetch> => {
	const method = getRequestMethod(input, init);

	if (method !== 'GET' && method !== 'HEAD') {
		return init ? [input, init] : [input];
	}

	const nextInit = init as NextFetchInit | undefined;

	return [
		input,
		{
			...init,
			next: {
				...nextInit?.next,
				revalidate: nextInit?.next?.revalidate ?? DIRECTUS_REVALIDATE_SECONDS,
			},
		} satisfies NextFetchInit,
	];
};

const fetchRetry = async (count: number, ...args: Parameters<typeof fetch>) => {
	const response = await fetch(...withDirectusCache(...args));

	if (count > 2 || response.status !== 429) return response;

	console.warn(`[429] Too Many Requests (Attempt ${count + 1})`);

	await sleep(500);

	return fetchRetry(count + 1, ...args);
};

// Queue for rate-limited requests
const queue = new Queue({ intervalCap: 10, interval: 500, carryoverConcurrencyCount: true });

const directusUrl = process.env.NEXT_PUBLIC_DIRECTUS_URL as string;

export const getDirectusServerToken = () => {
	const token = process.env.DIRECTUS_SERVER_TOKEN?.trim();

	if (!token) {
		throw new Error('DIRECTUS_SERVER_TOKEN is not defined. Check your .env file.');
	}

	return token;
};

const directus = createDirectus<Schema>(directusUrl, {
	globals: {
		fetch: (...args) => queue.add(() => fetchRetry(0, ...args)),
	},
}).with(rest());

export const useDirectus = () => ({
	directus: directus as RestClient<Schema>,
	readItems,
	readItem,
	readSingleton,
	readUser,
	createItem,
	updateItem,
	uploadFiles,
	withToken,
});

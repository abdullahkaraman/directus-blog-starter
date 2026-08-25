import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EDITORIAL_MEMORY_SCHEMA_VERSION = 1;
export const EDITORIAL_MEMORY_MAX_ACTIVE_RULES = 50;
export const EDITORIAL_MEMORY_MAX_RULE_CHARACTERS = 500;
export const EDITORIAL_MEMORY_MAX_BYTES = 20 * 1024;
export const EDITORIAL_MEMORY_PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PROPOSAL_ID_PATTERN = /^hm_[a-f0-9]{12}$/;
const RULE_ID_PATTERN = /^hr_[a-f0-9]{12}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PROPOSAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'expired']);
const RULE_STATUSES = new Set(['active', 'inactive']);

export class EditorialMemoryError extends Error {
	constructor(message, code = 'EDITORIAL_MEMORY_ERROR') {
		super(message);
		this.name = new.target.name;
		this.code = code;
	}
}

export class EditorialMemoryCorruptionError extends EditorialMemoryError {
	constructor(message, options = undefined) {
		super(message, 'EDITORIAL_MEMORY_CORRUPT');
		if (options?.cause) this.cause = options.cause;
	}
}

export class EditorialMemoryValidationError extends EditorialMemoryError {
	constructor(message) {
		super(message, 'EDITORIAL_MEMORY_INVALID');
	}
}

export class EditorialMemoryConflictError extends EditorialMemoryError {
	constructor(message) {
		super(message, 'EDITORIAL_MEMORY_CONFLICT');
	}
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
	return structuredClone(value);
}

function requiredText(value, name) {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new EditorialMemoryValidationError(`${name} is required.`);

	return text;
}

function optionalText(value) {
	const text = typeof value === 'string' ? value.trim() : '';

	return text || null;
}

function stringArray(value, name) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new EditorialMemoryValidationError(`${name} must be an array of strings.`);
	}

	return value.flatMap((item) => {
		const trimmedItem = item.trim();

		return trimmedItem ? [trimmedItem] : [];
	});
}

function isoTimestamp(value, name) {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
		throw new EditorialMemoryCorruptionError(`${name} must be a valid ISO timestamp.`);
	}
}

function characterCount(value) {
	return Array.from(value).length;
}

export function normalizeEditorialRule(value) {
	return requiredText(value, 'rule').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('tr-TR');
}

function validateRuleText(value) {
	const text = requiredText(value, 'rule');
	if (characterCount(text) > EDITORIAL_MEMORY_MAX_RULE_CHARACTERS) {
		throw new EditorialMemoryValidationError(`rule cannot exceed ${EDITORIAL_MEMORY_MAX_RULE_CHARACTERS} characters.`);
	}

	return { text, normalizedText: normalizeEditorialRule(text) };
}

export function renderDynamicEditorialMemory(rules) {
	return rules.flatMap((rule) => (rule.status === 'active' ? [`- ${rule.text}`] : [])).join('\n');
}

function hashMemory(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildEditorialMemorySnapshot(state) {
	const activeRules = state.rules.flatMap((rule) =>
		rule.status === 'active' ? [{ id: rule.id, text: rule.text }] : [],
	);
	const content = renderDynamicEditorialMemory(activeRules.map((rule) => ({ ...rule, status: 'active' })));

	return {
		schemaVersion: state.schemaVersion,
		hash: hashMemory(content),
		sizeBytes: Buffer.byteLength(content, 'utf8'),
		activeRuleCount: activeRules.length,
		rules: activeRules,
		content,
	};
}

export function createEmptyEditorialMemoryState(now = new Date().toISOString()) {
	const state = {
		schemaVersion: EDITORIAL_MEMORY_SCHEMA_VERSION,
		createdAt: now,
		updatedAt: now,
		activeMemoryHash: hashMemory(''),
		proposals: [],
		rules: [],
		audit: [],
	};

	return state;
}

function corruption(condition, message) {
	if (!condition) throw new EditorialMemoryCorruptionError(message);
}

export function validateEditorialMemoryState(state) {
	corruption(isPlainObject(state), 'Editorial memory ledger must be a JSON object.');
	corruption(
		state.schemaVersion === EDITORIAL_MEMORY_SCHEMA_VERSION,
		`Unsupported editorial memory schema version: ${String(state.schemaVersion)}.`,
	);
	isoTimestamp(state.createdAt, 'createdAt');
	isoTimestamp(state.updatedAt, 'updatedAt');
	corruption(HASH_PATTERN.test(state.activeMemoryHash), 'activeMemoryHash is invalid.');
	corruption(Array.isArray(state.proposals), 'proposals must be an array.');
	corruption(Array.isArray(state.rules), 'rules must be an array.');
	corruption(Array.isArray(state.audit), 'audit must be an array.');

	const proposalIds = new Set();
	const publicationIds = new Set();
	const postIds = new Set();
	const normalizedProposalTexts = new Set();
	const proposalsById = new Map();
	for (const proposal of state.proposals) {
		corruption(isPlainObject(proposal), 'Every proposal must be an object.');
		corruption(PROPOSAL_ID_PATTERN.test(proposal.id), `Invalid proposal id: ${String(proposal.id)}.`);
		corruption(!proposalIds.has(proposal.id), `Duplicate proposal id: ${proposal.id}.`);
		proposalIds.add(proposal.id);
		proposalsById.set(proposal.id, proposal);
		corruption(
			typeof proposal.publicationJobId === 'string' && proposal.publicationJobId.length > 0,
			'Proposal publicationJobId is required.',
		);
		corruption(
			!publicationIds.has(proposal.publicationJobId),
			`Publication ${proposal.publicationJobId} has more than one proposal.`,
		);
		publicationIds.add(proposal.publicationJobId);
		if (proposal.postId) {
			corruption(!postIds.has(proposal.postId), `Post ${proposal.postId} has more than one proposal.`);
			postIds.add(proposal.postId);
		}
		corruption(PROPOSAL_STATUSES.has(proposal.status), `Invalid proposal status: ${String(proposal.status)}.`);
		const bodyPruned = Boolean(proposal.bodyPrunedAt);
		if (bodyPruned) {
			corruption(
				['rejected', 'expired'].includes(proposal.status),
				'Only rejected or expired proposal bodies can be pruned.',
			);
			isoTimestamp(proposal.bodyPrunedAt, `Proposal ${proposal.id} bodyPrunedAt`);
			corruption(proposal.text === null, `Pruned proposal ${proposal.id} text must be null.`);
			corruption(proposal.rationale === null, `Pruned proposal ${proposal.id} rationale must be null.`);
			corruption(
				Array.isArray(proposal.evidence) && proposal.evidence.length === 0,
				`Pruned proposal ${proposal.id} evidence must be empty.`,
			);
			corruption(
				typeof proposal.normalizedText === 'string' && proposal.normalizedText.length > 0,
				`Pruned proposal ${proposal.id} normalizedText is required.`,
			);
		} else {
			corruption(typeof proposal.text === 'string' && proposal.text.trim().length > 0, 'Proposal text is required.');
			corruption(characterCount(proposal.text) <= EDITORIAL_MEMORY_MAX_RULE_CHARACTERS, 'Proposal text is too long.');
			corruption(
				proposal.normalizedText === normalizeEditorialRule(proposal.text),
				`Proposal ${proposal.id} has an invalid normalizedText.`,
			);
		}
		corruption(!normalizedProposalTexts.has(proposal.normalizedText), `Duplicate normalized proposal: ${proposal.id}.`);
		normalizedProposalTexts.add(proposal.normalizedText);
		isoTimestamp(proposal.createdAt, `Proposal ${proposal.id} createdAt`);
		isoTimestamp(proposal.updatedAt, `Proposal ${proposal.id} updatedAt`);
		isoTimestamp(proposal.expiresAt, `Proposal ${proposal.id} expiresAt`);
		corruption(Array.isArray(proposal.sourceJobIds), `Proposal ${proposal.id} sourceJobIds must be an array.`);
	}

	const ruleIds = new Set();
	const normalizedRuleTexts = new Set();
	const rulesById = new Map();
	for (const rule of state.rules) {
		corruption(isPlainObject(rule), 'Every rule must be an object.');
		corruption(RULE_ID_PATTERN.test(rule.id), `Invalid rule id: ${String(rule.id)}.`);
		corruption(!ruleIds.has(rule.id), `Duplicate rule id: ${rule.id}.`);
		ruleIds.add(rule.id);
		rulesById.set(rule.id, rule);
		corruption(RULE_STATUSES.has(rule.status), `Invalid rule status: ${String(rule.status)}.`);
		corruption(proposalIds.has(rule.proposalId), `Rule ${rule.id} references an unknown proposal.`);
		corruption(typeof rule.text === 'string' && rule.text.trim().length > 0, `Rule ${rule.id} text is required.`);
		corruption(characterCount(rule.text) <= EDITORIAL_MEMORY_MAX_RULE_CHARACTERS, `Rule ${rule.id} is too long.`);
		corruption(
			rule.normalizedText === normalizeEditorialRule(rule.text),
			`Rule ${rule.id} has an invalid normalizedText.`,
		);
		isoTimestamp(rule.createdAt, `Rule ${rule.id} createdAt`);
		corruption(!normalizedRuleTexts.has(rule.normalizedText), `Duplicate normalized rule: ${rule.id}.`);
		normalizedRuleTexts.add(rule.normalizedText);
	}

	for (const proposal of state.proposals) {
		if (proposal.status === 'approved') {
			const rule = rulesById.get(proposal.approvedRuleId);
			corruption(
				typeof proposal.approvedRuleId === 'string' && ruleIds.has(proposal.approvedRuleId) && rule,
				`Approved proposal ${proposal.id} has no approved rule.`,
			);
			corruption(
				rule.proposalId === proposal.id,
				`Approved proposal ${proposal.id} points to another proposal's rule.`,
			);
			corruption(
				rule.publicationJobId === proposal.publicationJobId,
				`Rule ${rule.id} has an inconsistent publicationJobId.`,
			);
			corruption(rule.normalizedText === proposal.normalizedText, `Rule ${rule.id} does not match its proposal.`);
		} else {
			corruption(proposal.approvedRuleId === null, `Unapproved proposal ${proposal.id} points to a rule.`);
		}
	}
	for (const rule of state.rules) {
		const proposal = proposalsById.get(rule.proposalId);
		corruption(
			proposal?.status === 'approved' && proposal.approvedRuleId === rule.id,
			`Rule ${rule.id} is not linked from its approved proposal.`,
		);
	}

	const snapshot = buildEditorialMemorySnapshot(state);
	corruption(snapshot.activeRuleCount <= EDITORIAL_MEMORY_MAX_ACTIVE_RULES, 'Too many active editorial rules.');
	corruption(snapshot.sizeBytes <= EDITORIAL_MEMORY_MAX_BYTES, 'Dynamic editorial memory exceeds its byte limit.');
	corruption(snapshot.hash === state.activeMemoryHash, 'activeMemoryHash does not match active rules.');

	for (const event of state.audit) {
		corruption(isPlainObject(event), 'Every audit event must be an object.');
		corruption(typeof event.action === 'string' && event.action.length > 0, 'Audit action is required.');
		isoTimestamp(event.at, 'Audit event timestamp');
	}

	return state;
}

export class EditorialMemoryStore {
	#stateFile;
	#now;
	#randomBytes;
	#lock = Promise.resolve();

	constructor({ stateFile = '/data/editorial/state.json', now = () => new Date(), randomBytesFn = randomBytes } = {}) {
		this.#stateFile = path.resolve(stateFile);
		this.#now = now;
		this.#randomBytes = randomBytesFn;
	}

	get stateFile() {
		return this.#stateFile;
	}

	async #withLock(operation) {
		const previous = this.#lock;
		let release;
		this.#lock = new Promise((resolve) => {
			release = resolve;
		});
		await previous;

		try {
			return await operation();
		} finally {
			release();
		}
	}

	#nowIso() {
		const value = this.#now();
		const date = value instanceof Date ? value : new Date(value);
		if (!Number.isFinite(date.getTime())) throw new EditorialMemoryValidationError('now() returned an invalid date.');

		return date.toISOString();
	}

	#createId(prefix, existingIds) {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const id = `${prefix}_${this.#randomBytes(6).toString('hex')}`;
			if (!existingIds.has(id)) return id;
		}

		throw new EditorialMemoryError('Could not allocate a unique editorial memory id.');
	}

	async #write(state) {
		state.updatedAt = this.#nowIso();
		state.activeMemoryHash = buildEditorialMemorySnapshot(state).hash;
		validateEditorialMemoryState(state);
		await mkdir(path.dirname(this.#stateFile), { recursive: true, mode: 0o700 });
		const temporary = `${this.#stateFile}.${randomUUID()}.tmp`;
		await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, this.#stateFile);
		await chmod(this.#stateFile, 0o600);

		return state;
	}

	async #read() {
		let raw;
		try {
			raw = await readFile(this.#stateFile, 'utf8');
		} catch (error) {
			if (error?.code === 'ENOENT') return null;
			throw error;
		}

		let state;
		try {
			state = JSON.parse(raw);
		} catch (error) {
			throw new EditorialMemoryCorruptionError('Editorial memory ledger is not valid JSON.', { cause: error });
		}

		return validateEditorialMemoryState(state);
	}

	#appendAudit(state, action, details = {}) {
		state.audit.push({
			at: this.#nowIso(),
			action,
			...details,
		});
	}

	#expirePending(state) {
		const now = this.#nowIso();
		const nowMs = Date.parse(now);
		let changed = false;
		for (const proposal of state.proposals) {
			if (proposal.status !== 'pending' || Date.parse(proposal.expiresAt) > nowMs) continue;
			proposal.status = 'expired';
			proposal.expiredAt = now;
			proposal.updatedAt = now;
			this.#appendAudit(state, 'proposal.expired', {
				proposalId: proposal.id,
				publicationJobId: proposal.publicationJobId,
			});
			changed = true;
		}

		return changed;
	}

	async #readInitialized({ expire = true } = {}) {
		let state = await this.#read();
		if (!state) {
			state = createEmptyEditorialMemoryState(this.#nowIso());
			await this.#write(state);
			return state;
		}
		if (expire && this.#expirePending(state)) await this.#write(state);

		return state;
	}

	async init() {
		return this.#withLock(async () => clone(await this.#readInitialized()));
	}

	async getState() {
		return this.#withLock(async () => clone(await this.#readInitialized()));
	}

	async getSnapshot() {
		return this.#withLock(async () => buildEditorialMemorySnapshot(await this.#readInitialized()));
	}

	async health() {
		try {
			const state = await this.#withLock(async () => this.#readInitialized({ expire: false }));
			const snapshot = buildEditorialMemorySnapshot(state);

			return {
				ok: true,
				schemaVersion: state.schemaVersion,
				hash: snapshot.hash,
				activeRuleCount: snapshot.activeRuleCount,
				pendingProposalCount: state.proposals.filter((proposal) => proposal.status === 'pending').length,
			};
		} catch (error) {
			return {
				ok: false,
				code: error?.code || 'EDITORIAL_MEMORY_UNAVAILABLE',
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async createProposal({
		publicationJobId,
		text,
		postId = null,
		sourceJobIds = [],
		rationale = null,
		evidence = [],
		actor = 'learning-agent',
	}) {
		const publicationId = requiredText(publicationJobId, 'publicationJobId');
		const validatedRule = validateRuleText(text);
		const sources = stringArray(sourceJobIds, 'sourceJobIds');
		const evidenceItems = stringArray(evidence, 'evidence');

		return this.#withLock(async () => {
			const state = await this.#readInitialized();
			const existingPublication = state.proposals.find(
				(proposal) =>
					proposal.publicationJobId === publicationId || (Boolean(postId) && proposal.postId === optionalText(postId)),
			);
			if (existingPublication) return { created: false, proposal: clone(existingPublication) };

			const duplicate =
				state.proposals.find((proposal) => proposal.normalizedText === validatedRule.normalizedText) ||
				state.rules.find((rule) => rule.normalizedText === validatedRule.normalizedText);
			if (duplicate) {
				throw new EditorialMemoryConflictError('The normalized editorial rule already exists in the ledger.');
			}

			const now = this.#nowIso();
			const id = this.#createId('hm', new Set(state.proposals.map((proposal) => proposal.id)));
			const proposal = {
				id,
				publicationJobId: publicationId,
				postId: optionalText(postId),
				sourceJobIds: sources,
				text: validatedRule.text,
				normalizedText: validatedRule.normalizedText,
				rationale: optionalText(rationale),
				evidence: evidenceItems,
				status: 'pending',
				createdAt: now,
				updatedAt: now,
				expiresAt: new Date(Date.parse(now) + EDITORIAL_MEMORY_PROPOSAL_TTL_MS).toISOString(),
				approvedRuleId: null,
			};
			state.proposals.push(proposal);
			this.#appendAudit(state, 'proposal.created', {
				proposalId: id,
				publicationJobId: publicationId,
				actor: optionalText(actor) || 'learning-agent',
			});
			await this.#write(state);

			return { created: true, proposal: clone(proposal) };
		});
	}

	async editProposal(proposalId, text, { actor = 'owner' } = {}) {
		const id = requiredText(proposalId, 'proposalId');
		const validatedRule = validateRuleText(text);

		return this.#withLock(async () => {
			const state = await this.#readInitialized();
			const proposal = state.proposals.find((candidate) => candidate.id === id);
			if (!proposal) throw new EditorialMemoryValidationError(`Unknown proposal: ${id}.`);
			if (proposal.status === 'pending' && proposal.normalizedText === validatedRule.normalizedText) {
				return clone(proposal);
			}
			if (proposal.status !== 'pending') {
				throw new EditorialMemoryConflictError('Only pending proposals can be edited.');
			}
			const duplicate =
				state.proposals.find(
					(candidate) => candidate.id !== id && candidate.normalizedText === validatedRule.normalizedText,
				) || state.rules.find((rule) => rule.normalizedText === validatedRule.normalizedText);
			if (duplicate) {
				throw new EditorialMemoryConflictError('The normalized editorial rule already exists in the ledger.');
			}

			proposal.text = validatedRule.text;
			proposal.normalizedText = validatedRule.normalizedText;
			proposal.updatedAt = this.#nowIso();
			proposal.editedAt = proposal.updatedAt;
			this.#appendAudit(state, 'proposal.edited', {
				proposalId: id,
				publicationJobId: proposal.publicationJobId,
				actor: optionalText(actor) || 'owner',
			});
			await this.#write(state);

			return clone(proposal);
		});
	}

	async approveProposal(proposalId, { actor = 'owner' } = {}) {
		const id = requiredText(proposalId, 'proposalId');

		return this.#withLock(async () => {
			const state = await this.#readInitialized();
			const proposal = state.proposals.find((candidate) => candidate.id === id);
			if (!proposal) throw new EditorialMemoryValidationError(`Unknown proposal: ${id}.`);
			if (proposal.status === 'approved') {
				const rule = state.rules.find((candidate) => candidate.id === proposal.approvedRuleId);
				return { proposal: clone(proposal), rule: clone(rule), snapshot: buildEditorialMemorySnapshot(state) };
			}
			if (proposal.status !== 'pending') {
				throw new EditorialMemoryConflictError('Only pending proposals can be approved.');
			}
			const activeRules = state.rules.filter((rule) => rule.status === 'active');
			if (activeRules.length >= EDITORIAL_MEMORY_MAX_ACTIVE_RULES) {
				throw new EditorialMemoryConflictError(
					`Editorial memory cannot contain more than ${EDITORIAL_MEMORY_MAX_ACTIVE_RULES} active rules.`,
				);
			}
			if (activeRules.some((rule) => rule.normalizedText === proposal.normalizedText)) {
				throw new EditorialMemoryConflictError('The normalized editorial rule is already active.');
			}

			const now = this.#nowIso();
			const rule = {
				id: this.#createId('hr', new Set(state.rules.map((candidate) => candidate.id))),
				proposalId: proposal.id,
				publicationJobId: proposal.publicationJobId,
				text: proposal.text,
				normalizedText: proposal.normalizedText,
				status: 'active',
				createdAt: now,
				updatedAt: now,
				deactivatedAt: null,
			};
			const candidateRules = [...state.rules, rule];
			const candidateContent = renderDynamicEditorialMemory(candidateRules);
			if (Buffer.byteLength(candidateContent, 'utf8') > EDITORIAL_MEMORY_MAX_BYTES) {
				throw new EditorialMemoryConflictError(
					`Dynamic editorial memory cannot exceed ${EDITORIAL_MEMORY_MAX_BYTES} bytes.`,
				);
			}

			state.rules.push(rule);
			proposal.status = 'approved';
			proposal.approvedAt = now;
			proposal.approvedRuleId = rule.id;
			proposal.updatedAt = now;
			this.#appendAudit(state, 'proposal.approved', {
				proposalId: proposal.id,
				ruleId: rule.id,
				publicationJobId: proposal.publicationJobId,
				actor: optionalText(actor) || 'owner',
			});
			await this.#write(state);

			return { proposal: clone(proposal), rule: clone(rule), snapshot: buildEditorialMemorySnapshot(state) };
		});
	}

	async rejectProposal(proposalId, { actor = 'owner', reason = null } = {}) {
		const id = requiredText(proposalId, 'proposalId');

		return this.#withLock(async () => {
			const state = await this.#readInitialized();
			const proposal = state.proposals.find((candidate) => candidate.id === id);
			if (!proposal) throw new EditorialMemoryValidationError(`Unknown proposal: ${id}.`);
			if (proposal.status === 'rejected') return clone(proposal);
			if (proposal.status !== 'pending') {
				throw new EditorialMemoryConflictError('Only pending proposals can be rejected.');
			}

			const now = this.#nowIso();
			proposal.status = 'rejected';
			proposal.rejectedAt = now;
			proposal.rejectionReason = optionalText(reason);
			proposal.updatedAt = now;
			this.#appendAudit(state, 'proposal.rejected', {
				proposalId: proposal.id,
				publicationJobId: proposal.publicationJobId,
				actor: optionalText(actor) || 'owner',
				reason: optionalText(reason),
			});
			await this.#write(state);

			return clone(proposal);
		});
	}

	async removeRule(ruleId, { actor = 'owner', reason = null } = {}) {
		const id = requiredText(ruleId, 'ruleId');

		return this.#withLock(async () => {
			const state = await this.#readInitialized();
			const rule = state.rules.find((candidate) => candidate.id === id);
			if (!rule) throw new EditorialMemoryValidationError(`Unknown rule: ${id}.`);
			if (rule.status === 'inactive') {
				return { rule: clone(rule), snapshot: buildEditorialMemorySnapshot(state) };
			}
			if (rule.status !== 'active') {
				throw new EditorialMemoryConflictError('Only active rules can be removed.');
			}

			const now = this.#nowIso();
			rule.status = 'inactive';
			rule.deactivatedAt = now;
			rule.deactivationReason = optionalText(reason);
			rule.updatedAt = now;
			this.#appendAudit(state, 'rule.removed', {
				ruleId: rule.id,
				proposalId: rule.proposalId,
				publicationJobId: rule.publicationJobId,
				actor: optionalText(actor) || 'owner',
				reason: optionalText(reason),
			});
			await this.#write(state);

			return { rule: clone(rule), snapshot: buildEditorialMemorySnapshot(state) };
		});
	}

	async expirePending() {
		return this.#withLock(async () => {
			const state = await this.#readInitialized({ expire: false });
			const changed = this.#expirePending(state);
			if (changed) await this.#write(state);

			return {
				changed,
				expired: clone(state.proposals.filter((proposal) => proposal.status === 'expired')),
			};
		});
	}

	async pruneProposalBodies({ retentionDays = 90 } = {}) {
		if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
			throw new EditorialMemoryValidationError('retentionDays must be a positive integer.');
		}

		return this.#withLock(async () => {
			const state = await this.#readInitialized();
			const cutoff = this.#now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
			const pruned = [];
			for (const proposal of state.proposals) {
				if (!['rejected', 'expired'].includes(proposal.status) || proposal.bodyPrunedAt) continue;
				const terminalAt = Date.parse(proposal.rejectedAt || proposal.expiredAt || proposal.updatedAt);
				if (!Number.isFinite(terminalAt) || terminalAt > cutoff) continue;
				proposal.text = null;
				proposal.rationale = null;
				proposal.evidence = [];
				proposal.bodyPrunedAt = this.#nowIso();
				proposal.updatedAt = proposal.bodyPrunedAt;
				this.#appendAudit(state, 'proposal.body-pruned', {
					proposalId: proposal.id,
					publicationJobId: proposal.publicationJobId,
				});
				pruned.push(proposal.id);
			}
			if (pruned.length) await this.#write(state);

			return { changed: pruned.length > 0, proposalIds: pruned };
		});
	}
}

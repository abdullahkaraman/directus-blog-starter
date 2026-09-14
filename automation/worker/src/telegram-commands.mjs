export const JOB_ID_PATTERN = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export const PROPOSAL_ID_PATTERN = 'hm_[a-f0-9]{12}';
export const RULE_ID_PATTERN = 'hr_[a-f0-9]{12}';

export const DEFAULT_IDEA_PROMPT = 'Yayın için güncel ve güçlü içerik fikirleri araştır.';

const JOB_ID = new RegExp(`^${JOB_ID_PATTERN}$`, 'i');
const PROPOSAL_ID = new RegExp(`^${PROPOSAL_ID_PATTERN}$`, 'i');
const RULE_ID = new RegExp(`^${RULE_ID_PATTERN}$`, 'i');

const TEXT_LIMITS = Object.freeze({
	article: 12_000,
	ideaTheme: 1_000,
	editInstruction: 8_000,
	memoryRule: 500,
});

const command = (name, type, usage, description, options = {}) =>
	Object.freeze({
		name,
		type,
		usage,
		description,
		aliases: Object.freeze(options.aliases || []),
		group: options.group || 'Diğer',
	});

export const TELEGRAM_COMMANDS = Object.freeze([
	command('yazi', 'article', '/yazi <konu>', 'Belirttiğiniz konuda yeni bir yazı taslağı hazırlar.', {
		group: 'İçerik',
	}),
	command('fikir', 'ideas', '/fikir [tema]', 'Güncel kaynaklarla yazı fikirleri araştırır.', { group: 'İçerik' }),
	command('sec', 'select-idea', '/sec <fikir-iş-no> <seçenek-no>', 'Araştırmadaki bir fikri yazı işine dönüştürür.', {
		group: 'İçerik',
	}),
	command('durum', 'status', '/durum <iş-no>', 'Bir işin güncel durumunu gösterir.', { group: 'İşler' }),
	command('sonisler', 'recent', '/sonisler', 'Son işlerin kısa durum listesini gösterir.', { group: 'İşler' }),
	command('edit', 'edit', '/edit <iş-no> <talimat>', 'Bir taslağı verdiğiniz talimatla düzenler.', { group: 'İçerik' }),
	command('yayinla', 'publish', '/yayinla <iş-no>', 'Onayladığınız taslağı yayımlar.', {
		aliases: ['yayınla'],
		group: 'İçerik',
	}),
	command('tekrar', 'retry', '/tekrar <iş-no>', 'Başarısız veya iptal edilmiş bir işi yeniden dener.', {
		group: 'İşler',
	}),
	command('iptal', 'cancel', '/iptal <iş-no>', 'Uygun aşamadaki bir işi güvenle iptal eder.', { group: 'İşler' }),
	command('metrik', 'metrics', '/metrik [iş-no]', 'İşlerin model, süre ve token ölçümlerini gösterir.', {
		group: 'İşler',
	}),
	command('hafiza', 'memory', '/hafiza', 'Onay bekleyen önerileri ve etkin kuralları gösterir.', { group: 'Hafıza' }),
	command(
		'hafiza_duzenle',
		'memory-edit',
		'/hafiza_duzenle <öneri-no> <yeni-kural>',
		'Onay bekleyen bir hafıza önerisini düzenler.',
		{ group: 'Hafıza' },
	),
	command('hafiza_onayla', 'memory-approve', '/hafiza_onayla <öneri-no>', 'Bir hafıza önerisini etkinleştirir.', {
		group: 'Hafıza',
	}),
	command('hafiza_reddet', 'memory-reject', '/hafiza_reddet <öneri-no>', 'Bir hafıza önerisini reddeder.', {
		group: 'Hafıza',
	}),
	command('hafiza_kaldir', 'memory-remove', '/hafiza_kaldir <kural-no>', 'Etkin bir hafıza kuralını kaldırır.', {
		group: 'Hafıza',
	}),
	command('yardim', 'help', '/yardim', 'Komutları ve kısa kullanım açıklamalarını gösterir.', { group: 'Yardım' }),
	command('start', 'help', '/start', 'Botu tanıtır ve komut yardımını gösterir.', { group: 'Yardım' }),
]);
const TELEGRAM_COMMAND_CATALOG = TELEGRAM_COMMANDS;

const COMMAND_BY_NAME = new Map();
for (const definition of TELEGRAM_COMMANDS) {
	COMMAND_BY_NAME.set(definition.name, definition);
	for (const alias of definition.aliases) COMMAND_BY_NAME.set(alias, definition);
}

export class TelegramCommandError extends Error {
	constructor(code, message, { command: commandName = null, usage = null } = {}) {
		super(message);
		this.name = 'TelegramCommandError';
		this.code = code;
		this.command = commandName;
		this.usage = usage;
	}
}

export function isJobId(value) {
	return JOB_ID.test(String(value || ''));
}

export function isProposalId(value) {
	return PROPOSAL_ID.test(String(value || ''));
}

export function isRuleId(value) {
	return RULE_ID.test(String(value || ''));
}

function commandError(definition, message, code = 'INVALID_USAGE') {
	throw new TelegramCommandError(code, message, {
		command: definition.name,
		usage: definition.usage,
	});
}

function requireNoArguments(definition, argumentsText) {
	if (argumentsText) commandError(definition, 'Bu komut ek bir değer kabul etmiyor.');
}

function requireText(definition, value, label, maxLength) {
	const normalized = String(value || '').trim();
	if (!normalized) commandError(definition, `${label} boş bırakılamaz.`);
	if (normalized.length > maxLength) {
		commandError(definition, `${label} en fazla ${maxLength} karakter olabilir.`, 'TEXT_TOO_LONG');
	}

	return normalized;
}

function optionalText(definition, value, label, maxLength) {
	const normalized = String(value || '').trim();
	if (!normalized) return null;
	if (normalized.length > maxLength) {
		commandError(definition, `${label} en fazla ${maxLength} karakter olabilir.`, 'TEXT_TOO_LONG');
	}

	return normalized;
}

function oneArgument(definition, argumentsText) {
	const parts = String(argumentsText || '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (parts.length !== 1) commandError(definition, 'Komut için tek bir değer gerekli.');

	return parts[0];
}

function firstArgumentAndRest(definition, argumentsText) {
	const match = String(argumentsText || '')
		.trim()
		.match(/^(\S+)\s+([\s\S]+)$/);
	if (!match) commandError(definition, 'Komutun gerekli alanları eksik.');

	return [match[1], match[2].trim()];
}

function jobIdArgument(definition, value) {
	if (!isJobId(value)) commandError(definition, 'Geçerli bir iş numarası girin.', 'INVALID_JOB_ID');

	return value.toLowerCase();
}

function proposalIdArgument(definition, value) {
	if (!isProposalId(value)) {
		commandError(definition, 'Öneri numarası hm_ ile başlayan 12 haneli kimlik olmalı.', 'INVALID_PROPOSAL_ID');
	}

	return value.toLowerCase();
}

function ruleIdArgument(definition, value) {
	if (!isRuleId(value)) {
		commandError(definition, 'Kural numarası hr_ ile başlayan 12 haneli kimlik olmalı.', 'INVALID_RULE_ID');
	}

	return value.toLowerCase();
}

function baseResult(definition, originalPrompt) {
	return {
		type: definition.type,
		command: definition.name,
		originalPrompt,
	};
}

function parseKnownCommand(definition, argumentsText, originalPrompt, contentProfile) {
	const base = baseResult(definition, originalPrompt);

	switch (definition.name) {
		case 'yazi': {
			const prompt = requireText(definition, argumentsText, 'Yazı konusu', TEXT_LIMITS.article);
			return { ...base, prompt };
		}
		case 'fikir': {
			const theme = optionalText(definition, argumentsText, 'Fikir teması', TEXT_LIMITS.ideaTheme);
			return { ...base, theme, prompt: theme || contentProfile?.ideas?.defaultPrompt || DEFAULT_IDEA_PROMPT };
		}
		case 'sec': {
			const parts = String(argumentsText || '')
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			if (parts.length !== 2) commandError(definition, 'Fikir işi ve seçenek numarası gerekli.');
			const sourceIdeaJobId = jobIdArgument(definition, parts[0]);
			if (!/^[1-9]\d*$/.test(parts[1])) {
				commandError(definition, 'Seçenek numarası 1 veya daha büyük bir tam sayı olmalı.', 'INVALID_IDEA_NUMBER');
			}
			const selectedIdeaNumber = Number(parts[1]);
			if (!Number.isSafeInteger(selectedIdeaNumber)) {
				commandError(definition, 'Seçenek numarası çok büyük.', 'INVALID_IDEA_NUMBER');
			}
			return { ...base, sourceIdeaJobId, selectedIdeaNumber };
		}
		case 'durum':
		case 'yayinla':
		case 'tekrar':
		case 'iptal': {
			const targetJobId = jobIdArgument(definition, oneArgument(definition, argumentsText));
			return { ...base, targetJobId };
		}
		case 'edit': {
			const [rawJobId, rawInstruction] = firstArgumentAndRest(definition, argumentsText);
			const targetJobId = jobIdArgument(definition, rawJobId);
			const prompt = requireText(definition, rawInstruction, 'Düzenleme talimatı', TEXT_LIMITS.editInstruction);
			return { ...base, targetJobId, prompt };
		}
		case 'metrik': {
			const rawJobId = optionalText(definition, argumentsText, 'İş numarası', 100);
			const targetJobId = rawJobId ? jobIdArgument(definition, oneArgument(definition, rawJobId)) : null;
			return { ...base, targetJobId };
		}
		case 'hafiza_duzenle': {
			const [rawProposalId, rawRule] = firstArgumentAndRest(definition, argumentsText);
			const proposalId = proposalIdArgument(definition, rawProposalId);
			const rule = requireText(definition, rawRule, 'Yeni kural', TEXT_LIMITS.memoryRule);
			return { ...base, proposalId, rule };
		}
		case 'hafiza_onayla':
		case 'hafiza_reddet': {
			const proposalId = proposalIdArgument(definition, oneArgument(definition, argumentsText));
			return { ...base, proposalId };
		}
		case 'hafiza_kaldir': {
			const ruleId = ruleIdArgument(definition, oneArgument(definition, argumentsText));
			return { ...base, ruleId };
		}
		case 'sonisler':
		case 'hafiza':
		case 'yardim':
		case 'start':
			requireNoArguments(definition, argumentsText);
			return base;
		default:
			throw new TelegramCommandError('UNKNOWN_COMMAND', `Bilinmeyen komut: /${definition.name}`);
	}
}

export function parseTelegramCommand(rawValue, contentProfile = null) {
	const originalPrompt = String(rawValue || '').trim();
	if (!originalPrompt) {
		throw new TelegramCommandError('EMPTY_INPUT', 'Mesaj boş olamaz. Kullanılabilir komutlar için /yardim yazın.');
	}

	if (!originalPrompt.startsWith('/')) {
		if (originalPrompt.length > TEXT_LIMITS.article) {
			throw new TelegramCommandError('TEXT_TOO_LONG', `Yazı talebi en fazla ${TEXT_LIMITS.article} karakter olabilir.`);
		}
		return { type: 'article', command: null, originalPrompt, prompt: originalPrompt };
	}

	const match = originalPrompt.match(/^\/([^\s@]+)(?:@[A-Za-z0-9_]{5,32})?(?:\s+([\s\S]*))?$/u);
	if (!match) throw new TelegramCommandError('UNKNOWN_COMMAND', 'Komut biçimi anlaşılamadı.');

	const requestedName = match[1].toLowerCase();
	const definition = COMMAND_BY_NAME.get(requestedName);
	if (!definition) {
		throw new TelegramCommandError('UNKNOWN_COMMAND', `Bilinmeyen komut: /${match[1]}`, { command: requestedName });
	}

	return parseKnownCommand(definition, String(match[2] || '').trim(), originalPrompt, contentProfile);
}

export function getTelegramCommand(commandName) {
	const normalized = String(commandName || '')
		.replace(/^\//, '')
		.toLowerCase();
	return COMMAND_BY_NAME.get(normalized) || null;
}

export function formatCommandUsage(commandName) {
	const definition = getTelegramCommand(commandName);
	return definition
		? `Kullanım: ${definition.usage}\n${definition.description}`
		: 'Kullanılabilir komutlar için /yardim yazın.';
}

export function formatUnknownCommand(commandName = '') {
	const normalized = String(commandName || '')
		.trim()
		.replace(/^\//, '');
	const firstLine = normalized ? `Bilinmeyen komut: /${normalized}` : 'Komut anlaşılamadı.';
	return `${firstLine}\n\nKullanılabilir komutları görmek için /yardim yazın.`;
}

export function formatTelegramCommandError(error) {
	if (!(error instanceof TelegramCommandError)) return 'İstek işlenemedi. Lütfen tekrar deneyin.';
	if (error.code === 'UNKNOWN_COMMAND')
		return error.command ? formatUnknownCommand(error.command) : formatUnknownCommand();

	const lines = [error.message];
	if (error.usage) lines.push('', `Kullanım: ${error.usage}`);
	return lines.join('\n');
}

export function formatTelegramHelp(contentProfile = null) {
	const groups = new Map();
	for (const definition of TELEGRAM_COMMANDS) {
		if (definition.name === 'start') continue;
		const definitions = groups.get(definition.group) || [];
		definitions.push(definition);
		groups.set(definition.group, definitions);
	}

	const lines = [
		contentProfile?.publication?.assistantName || 'İçerik asistanı',
		'',
		'Düz bir mesaj göndererek de yeni yazı talebi oluşturabilirsiniz.',
	];
	for (const [group, definitions] of groups) {
		lines.push('', group);
		for (const definition of definitions) lines.push(`${definition.usage} — ${definition.description}`);
	}

	return lines.join('\n');
}

export function getBotFatherCommands() {
	return TELEGRAM_COMMANDS.map(({ name, description }) => ({ command: name, description }));
}

export function formatBotFatherCommands() {
	return getBotFatherCommands()
		.map(({ command: commandName, description }) => `${commandName} - ${description}`)
		.join('\n');
}

export function immediateResponse(message) {
	const normalized = String(message || '').trim();
	if (!normalized) throw new TypeError('Immediate response message cannot be empty.');

	return { immediateResponse: true, message: normalized };
}

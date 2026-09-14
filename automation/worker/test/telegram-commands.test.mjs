import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TELEGRAM_COMMANDS,
	TelegramCommandError,
	formatBotFatherCommands,
	formatCommandUsage,
	formatTelegramCommandError,
	formatTelegramHelp,
	getBotFatherCommands,
	immediateResponse,
	isJobId,
	isProposalId,
	isRuleId,
	parseTelegramCommand,
} from '../src/telegram-commands.mjs';

const jobId = 'bb549ac3-1710-4e7e-930b-76cac45c7685';

test('command catalog contains every approved canonical Telegram command', () => {
	assert.deepEqual(
		TELEGRAM_COMMANDS.map(({ name }) => name),
		[
			'yazi',
			'fikir',
			'sec',
			'durum',
			'sonisler',
			'edit',
			'yayinla',
			'tekrar',
			'iptal',
			'metrik',
			'hafiza',
			'hafiza_duzenle',
			'hafiza_onayla',
			'hafiza_reddet',
			'hafiza_kaldir',
			'yardim',
			'start',
		],
	);
});

test('plain text and /yazi both create normalized article requests', () => {
	assert.deepEqual(parseTelegramCommand('  Doğrulama döngülerini anlat.  '), {
		type: 'article',
		command: null,
		originalPrompt: 'Doğrulama döngülerini anlat.',
		prompt: 'Doğrulama döngülerini anlat.',
	});
	assert.deepEqual(parseTelegramCommand('/yazi Sıcak bir öğretmen tonuyla checkpoint anlat.'), {
		type: 'article',
		command: 'yazi',
		originalPrompt: '/yazi Sıcak bir öğretmen tonuyla checkpoint anlat.',
		prompt: 'Sıcak bir öğretmen tonuyla checkpoint anlat.',
	});
});

test('/fikir accepts an optional theme and exposes the normalized theme', () => {
	const general = parseTelegramCommand('/fikir');
	const themed = parseTelegramCommand('/fikir  yapay zekâ güvenliği ');

	assert.equal(general.type, 'ideas');
	assert.equal(general.theme, null);
	assert.match(general.prompt, /güncel ve güçlü/);
	assert.equal(themed.theme, 'yapay zekâ güvenliği');
	assert.equal(themed.prompt, themed.theme);
});

test('/sec validates and normalizes its source job and one-based option number', () => {
	assert.deepEqual(parseTelegramCommand(`/sec ${jobId.toUpperCase()} 3`), {
		type: 'select-idea',
		command: 'sec',
		originalPrompt: `/sec ${jobId.toUpperCase()} 3`,
		sourceIdeaJobId: jobId,
		selectedIdeaNumber: 3,
	});
	assert.throws(() => parseTelegramCommand(`/sec ${jobId} 0`), (error) => error.code === 'INVALID_IDEA_NUMBER');
	assert.throws(() => parseTelegramCommand(`/sec ${jobId} 1.5`), (error) => error.code === 'INVALID_IDEA_NUMBER');
});

test('job commands require UUIDs and normalize them', () => {
	const expectations = [
		['durum', 'status'],
		['yayinla', 'publish'],
		['tekrar', 'retry'],
		['iptal', 'cancel'],
	];
	for (const [command, type] of expectations) {
		const parsed = parseTelegramCommand(`/${command} ${jobId.toUpperCase()}`);
		assert.equal(parsed.type, type);
		assert.equal(parsed.command, command);
		assert.equal(parsed.targetJobId, jobId);
	}

	assert.equal(parseTelegramCommand(`/yayınla ${jobId}`).command, 'yayinla');
	assert.throws(() => parseTelegramCommand('/durum yanlış'), (error) => error.code === 'INVALID_JOB_ID');
});

test('/edit preserves a multiline instruction after the normalized job id', () => {
	const parsed = parseTelegramCommand(`/edit ${jobId} Girişi kısalt.\nTonu daha sıcak yap.`);
	assert.equal(parsed.type, 'edit');
	assert.equal(parsed.targetJobId, jobId);
	assert.equal(parsed.prompt, 'Girişi kısalt.\nTonu daha sıcak yap.');
});

test('/metrik accepts either no argument or one valid job id', () => {
	assert.equal(parseTelegramCommand('/metrik').targetJobId, null);
	assert.equal(parseTelegramCommand(`/metrik ${jobId}`).targetJobId, jobId);
	assert.throws(() => parseTelegramCommand(`/metrik ${jobId} fazla`), (error) => error.code === 'INVALID_USAGE');
});

test('memory commands validate persisted proposal and rule identifiers', () => {
	assert.deepEqual(parseTelegramCommand('/hafiza_onayla HM_A1B2C3D4E5F6'), {
		type: 'memory-approve',
		command: 'hafiza_onayla',
		originalPrompt: '/hafiza_onayla HM_A1B2C3D4E5F6',
		proposalId: 'hm_a1b2c3d4e5f6',
	});
	assert.equal(parseTelegramCommand('/hafiza_reddet hm_abcdef123456').proposalId, 'hm_abcdef123456');
	assert.equal(parseTelegramCommand('/hafiza_kaldir HR_ABCDEF123456').ruleId, 'hr_abcdef123456');
	assert.deepEqual(parseTelegramCommand('/hafiza_duzenle hm_abcdef123456 Girişlerde doğrudan probleme başla.'), {
		type: 'memory-edit',
		command: 'hafiza_duzenle',
		originalPrompt: '/hafiza_duzenle hm_abcdef123456 Girişlerde doğrudan probleme başla.',
		proposalId: 'hm_abcdef123456',
		rule: 'Girişlerde doğrudan probleme başla.',
	});
	assert.throws(() => parseTelegramCommand('/hafiza_onayla 1'), (error) => error.code === 'INVALID_PROPOSAL_ID');
	assert.throws(() => parseTelegramCommand('/hafiza_kaldir hm_abcdef123456'), (error) => error.code === 'INVALID_RULE_ID');
	assert.throws(
		() => parseTelegramCommand(`/hafiza_duzenle hm_abcdef123456 ${'x'.repeat(501)}`),
		(error) => error.code === 'TEXT_TOO_LONG',
	);
});

test('argument-free commands reject extra text and /start maps to help', () => {
	for (const command of ['sonisler', 'hafiza', 'yardim']) assert.equal(parseTelegramCommand(`/${command}`).command, command);
	assert.equal(parseTelegramCommand('/start').type, 'help');
	assert.throws(() => parseTelegramCommand('/sonisler şimdi'), (error) => error.code === 'INVALID_USAGE');
});

test('Telegram bot username suffixes and command case are accepted', () => {
	const parsed = parseTelegramCommand(`/DURUM@contentops_bot ${jobId}`);
	assert.equal(parsed.command, 'durum');
	assert.equal(parsed.targetJobId, jobId);
	assert.equal(parseTelegramCommand('/FIKIR').command, 'fikir');
});

test('unknown slash commands never fall through as article requests', () => {
	assert.throws(
		() => parseTelegramCommand('/yanlis bir şey yap'),
		(error) => error instanceof TelegramCommandError && error.code === 'UNKNOWN_COMMAND',
	);
	assert.throws(() => parseTelegramCommand('   '), (error) => error.code === 'EMPTY_INPUT');
});

test('identifier validators reject lookalike and malformed values', () => {
	assert.equal(isJobId(jobId), true);
	assert.equal(isJobId('not-a-job'), false);
	assert.equal(isProposalId('hm_abcdef123456'), true);
	assert.equal(isProposalId('hr_abcdef123456'), false);
	assert.equal(isRuleId('hr_abcdef123456'), true);
	assert.equal(isRuleId('hr_zzzzzzzzzzzz'), false);
});

test('Turkish help, usage and validation formatters are ready for Telegram', () => {
	const help = formatTelegramHelp();
	assert.match(help, /Düz bir mesaj göndererek de yeni yazı talebi/);
	assert.match(help, /\/sec <fikir-iş-no> <seçenek-no>/);
	assert.match(help, /\/hafiza_onayla <öneri-no>/);
	assert.doesNotMatch(help, /^\/start/m);
	assert.ok(help.length < 4_096);
	assert.equal(formatCommandUsage('yayinla'), 'Kullanım: /yayinla <iş-no>\nOnayladığınız taslağı yayımlar.');

	let error;
	try {
		parseTelegramCommand('/durum yanlış');
	} catch (caught) {
		error = caught;
	}
	assert.equal(formatTelegramCommandError(error), 'Geçerli bir iş numarası girin.\n\nKullanım: /durum <iş-no>');
	assert.match(formatTelegramCommandError(new Error('secret')), /İstek işlenemedi/);
	assert.match(formatTelegramCommandError(new TelegramCommandError('UNKNOWN_COMMAND', 'bozuk')), /^Komut anlaşılamadı\./);
});

test('BotFather catalog is canonical, ASCII-safe and copyable', () => {
	const definitions = getBotFatherCommands();
	assert.equal(definitions.length, TELEGRAM_COMMANDS.length);
	assert.ok(
		definitions.every(
			({ command, description }) => /^[a-z0-9_]{1,32}$/.test(command) && description.length >= 3 && description.length <= 256,
		),
	);
	assert.match(formatBotFatherCommands(), /^yazi - /);
	assert.match(formatBotFatherCommands(), /^hafiza_duzenle - /m);
});

test('immediateResponse creates the n8n response discriminator', () => {
	assert.deepEqual(immediateResponse('  İş iptal edildi.  '), {
		immediateResponse: true,
		message: 'İş iptal edildi.',
	});
	assert.throws(() => immediateResponse(' '), TypeError);
});

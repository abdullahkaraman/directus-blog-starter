import { parseTelegramCommand } from './telegram-commands.mjs';

export function parseJobRequest(rawValue, contentProfile = null) {
	return parseTelegramCommand(rawValue, contentProfile);
}

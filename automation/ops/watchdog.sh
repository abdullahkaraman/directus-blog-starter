#!/bin/sh

set -eu
umask 077

OPS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
AUTOMATION_DIR=$(CDPATH= cd -- "$OPS_DIR/.." && pwd -P)
ENV_FILE=${AUTOMATION_ENV_FILE:-$AUTOMATION_DIR/.env}

usage() {
	cat <<'EOF'
Usage: ./ops/watchdog.sh [--env-file PATH]

Checks the host-bound n8n and worker health endpoints once. Alerts and recovery
messages are deduplicated for six hours. Run this script every ten minutes from
systemd timer or cron so n8n outages can still be reported.
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--env-file)
			[ "$#" -ge 2 ] || exit 2
			ENV_FILE=$2
			shift 2
			;;
		-h | --help)
			usage
			exit 0
			;;
		*) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

file_mode() {
	stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_owner_uid() {
	stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"
}

[ -f "$ENV_FILE" ] || { printf 'Environment file not found: %s\n' "$ENV_FILE" >&2; exit 1; }
[ ! -L "$ENV_FILE" ] || { printf 'Environment file must not be a symbolic link: %s\n' "$ENV_FILE" >&2; exit 1; }
env_directory=$(CDPATH= cd -- "$(dirname -- "$ENV_FILE")" && pwd -P)
ENV_FILE=$env_directory/$(basename -- "$ENV_FILE")
env_mode=$(file_mode "$ENV_FILE")
case "$env_mode" in
	400 | 600) ;;
	*) printf 'Environment file permissions must be 0600 or 0400, got %s: %s\n' "$env_mode" "$ENV_FILE" >&2; exit 1 ;;
esac
[ "$(file_owner_uid "$ENV_FILE")" = "$(id -u)" ] \
	|| { printf 'Environment file must be owned by the current user: %s\n' "$ENV_FILE" >&2; exit 1; }
# Operator-owned KEY=value file, shared with Docker Compose.
# shellcheck disable=SC1090
. "$ENV_FILE"
: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN in $ENV_FILE}"
case "$TELEGRAM_BOT_TOKEN" in
	'' | *[!a-zA-Z0-9:_-]*) printf 'TELEGRAM_BOT_TOKEN contains unsupported characters\n' >&2; exit 1 ;;
esac
telegram_bot_token=$TELEGRAM_BOT_TOKEN
unset TELEGRAM_BOT_TOKEN
TELEGRAM_ALERT_CHAT_ID=${TELEGRAM_ALERT_CHAT_ID:-${TELEGRAM_ALLOWED_USER_ID:?Set TELEGRAM_ALERT_CHAT_ID}}
WATCHDOG_STATE_DIR=${WATCHDOG_STATE_DIR:-/var/lib/content-ops}
WATCHDOG_DEDUPE_SECONDS=${WATCHDOG_DEDUPE_SECONDS:-21600}
WATCHDOG_MAINTENANCE_MAX_SECONDS=${WATCHDOG_MAINTENANCE_MAX_SECONDS:-7200}
MAINTENANCE_MARKER_FILE=${MAINTENANCE_MARKER_FILE:-${BACKUP_DIR:-$WATCHDOG_STATE_DIR}/maintenance.state}
case "$WATCHDOG_DEDUPE_SECONDS" in
	'' | *[!0-9]*) printf 'WATCHDOG_DEDUPE_SECONDS must be a positive integer\n' >&2; exit 1 ;;
esac
case "$WATCHDOG_MAINTENANCE_MAX_SECONDS" in
	'' | *[!0-9]*) printf 'WATCHDOG_MAINTENANCE_MAX_SECONDS must be a positive integer\n' >&2; exit 1 ;;
esac
[ "$WATCHDOG_DEDUPE_SECONDS" -gt 0 ] && [ "$WATCHDOG_MAINTENANCE_MAX_SECONDS" -gt 0 ] \
	|| { printf 'Watchdog time values must be positive integers\n' >&2; exit 1; }
case "$WATCHDOG_STATE_DIR" in
	/*) ;;
	*) printf 'WATCHDOG_STATE_DIR must be an absolute path\n' >&2; exit 1 ;;
esac
case "$MAINTENANCE_MARKER_FILE" in
	/*) ;;
	*) printf 'MAINTENANCE_MARKER_FILE must be an absolute path\n' >&2; exit 1 ;;
esac

mkdir -p "$WATCHDOG_STATE_DIR"
command -v curl >/dev/null 2>&1 || { printf 'curl is required\n' >&2; exit 1; }
WATCHDOG_LOCK_DIR=$WATCHDOG_STATE_DIR/.watchdog.lock
if ! mkdir "$WATCHDOG_LOCK_DIR" 2>/dev/null; then
	watchdog_pid=
	[ ! -r "$WATCHDOG_LOCK_DIR/pid" ] || read -r watchdog_pid <"$WATCHDOG_LOCK_DIR/pid" || true
	case "$watchdog_pid" in
		'' | *[!0-9]*) watchdog_pid= ;;
	esac
	if [ -n "$watchdog_pid" ] && kill -0 "$watchdog_pid" 2>/dev/null; then
		printf 'Watchdog check skipped because another check is active.\n'
		exit 0
	fi
	rm -f "$WATCHDOG_LOCK_DIR/pid"
	if ! rmdir "$WATCHDOG_LOCK_DIR" 2>/dev/null || ! mkdir "$WATCHDOG_LOCK_DIR" 2>/dev/null; then
		printf 'Watchdog check skipped because lock ownership could not be established.\n'
		exit 0
	fi
fi
printf '%s\n' "$$" >"$WATCHDOG_LOCK_DIR/pid"
cleanup() {
	rm -f "$WATCHDOG_LOCK_DIR/pid"
	rmdir "$WATCHDOG_LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

notify() {
	message=$1
	curl --fail --silent --show-error --retry 2 \
		--data-urlencode "chat_id=$TELEGRAM_ALERT_CHAT_ID" \
		--data-urlencode "text=$message" \
		--config - >/dev/null <<EOF
url = "https://api.telegram.org/bot${telegram_bot_token}/sendMessage"
request = "POST"
EOF
}

record_condition() {
	key=$1
	active=$2
	message=$3
	state_file=$WATCHDOG_STATE_DIR/watchdog-$key.state
	previous_active=0
	last_notified=0
	if [ -f "$state_file" ]; then
		read -r previous_active last_notified <"$state_file" || true
	fi
	case "$previous_active" in
		0 | 1) ;;
		*) previous_active=0 ;;
	esac
	case "$last_notified" in
		'' | *[!0-9]*) last_notified=0 ;;
	esac
	now=$(date '+%s')
	if [ "$active" -eq 1 ]; then
		if [ "$previous_active" -ne 1 ] || [ $((now - last_notified)) -ge "$WATCHDOG_DEDUPE_SECONDS" ]; then
			notify "$message"
			last_notified=$now
		fi
	elif [ "$previous_active" -eq 1 ]; then
		notify "Düzeldi: $message"
		last_notified=$now
	fi
	temporary=$state_file.$$.tmp
	printf '%s %s\n' "$active" "$last_notified" >"$temporary"
	chmod 600 "$temporary"
	mv "$temporary" "$state_file"
}

maintenance_suppresses_health=0
maintenance_marker_stale=0
if [ -e "$MAINTENANCE_MARKER_FILE" ]; then
	if [ ! -r "$MAINTENANCE_MARKER_FILE" ]; then
		maintenance_marker_stale=1
	else
		maintenance_started=$(awk -F= '$1 == "started_epoch" {print $2; exit}' "$MAINTENANCE_MARKER_FILE")
		maintenance_suppress=$(awk -F= '$1 == "suppress_health" {print $2; exit}' "$MAINTENANCE_MARKER_FILE")
		case "$maintenance_started" in
			'' | *[!0-9]*) maintenance_marker_stale=1 ;;
		esac
		case "$maintenance_suppress" in
			0 | 1) ;;
			*) maintenance_marker_stale=1 ;;
		esac
		if [ "$maintenance_marker_stale" -eq 0 ]; then
			case "$maintenance_suppress" in
			1)
				now=$(date '+%s')
				maintenance_age=$((now - maintenance_started))
				if [ "$maintenance_age" -ge 0 ] && [ "$maintenance_age" -le "$WATCHDOG_MAINTENANCE_MAX_SECONDS" ]; then
					maintenance_suppresses_health=1
				else
					maintenance_marker_stale=1
				fi
				;;
			0) ;;
			esac
		fi
	fi
fi

if [ "$maintenance_marker_stale" -eq 1 ]; then
	record_condition maintenance-marker 1 'Bakım işareti bozuk veya süresi dolmuş; sağlık uyarıları yeniden etkin.'
else
	record_condition maintenance-marker 0 'Bakım işareti yeniden geçerli.'
fi

if [ "$maintenance_suppresses_health" -eq 1 ]; then
	printf 'Expected service downtime is covered by an active maintenance marker.\n'
	exit 0
fi

if curl --fail --silent --max-time 10 http://127.0.0.1:5678/healthz/readiness >/dev/null; then
	record_condition n8n 0 'n8n sağlık kontrolü yeniden başarılı.'
else
	record_condition n8n 1 'n8n sağlık kontrolü başarısız. Telegram otomasyonu erişilemiyor olabilir.'
fi

if curl --fail --silent --max-time 10 http://127.0.0.1:8787/health >/dev/null; then
	record_condition worker 0 'Codex worker sağlık kontrolü yeniden başarılı.'
else
	record_condition worker 1 'Codex worker sağlık kontrolü başarısız veya editoryal hafıza bozuk.'
fi

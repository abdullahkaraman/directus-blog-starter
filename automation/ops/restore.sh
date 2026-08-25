#!/bin/sh

set -eu

OPS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=./lib.sh
. "$OPS_DIR/lib.sh"

usage() {
	cat <<'EOF'
Usage: ./ops/restore.sh [--snapshot ID|latest] [--source-host HOST]
                        [--allow-cross-host] [--env-file PATH] [--confirm]

Without --confirm, downloads the selected Restic snapshot and validates every
artifact without changing PostgreSQL, Docker volumes or automation/.env.

With --confirm, stops n8n and codex-worker, then restores PostgreSQL,
n8n_data, worker_data and the encrypted environment file. PostgreSQL must be
running; application services remain stopped for operator review afterward.

The default restores only backups created by the current hostname and matching
BACKUP_PROJECT_ID. Disaster recovery on another host requires both an explicit
source host and --allow-cross-host. Project identity must always match.
EOF
}

SNAPSHOT=latest
SOURCE_HOST=
SOURCE_HOST_EXPLICIT=0
ALLOW_CROSS_HOST=0
CONFIRM=0
CONFIRMED_RESTORE_STARTED=0
RESTORE_SUCCEEDED=0

while [ "$#" -gt 0 ]; do
	case "$1" in
		--snapshot)
			[ "$#" -ge 2 ] || die "--snapshot requires an ID or latest"
			SNAPSHOT=$2
			shift 2
			;;
		--source-host)
			[ "$#" -ge 2 ] || die "--source-host requires a hostname"
			SOURCE_HOST=$2
			SOURCE_HOST_EXPLICIT=1
			shift 2
			;;
		--allow-cross-host)
			ALLOW_CROSS_HOST=1
			shift
			;;
		--env-file)
			[ "$#" -ge 2 ] || die "--env-file requires a path"
			ENV_FILE=$2
			shift 2
			;;
		--confirm)
			CONFIRM=1
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		*) die "Unknown argument: $1" ;;
	esac
done

require_command docker
require_command restic
require_command openssl
require_command tar
require_command awk
load_backup_environment
assert_repository_ready

case "$SNAPSHOT" in
	latest) ;;
	'' | *[!a-fA-F0-9]*) die "--snapshot must be latest or an 8-64 character hexadecimal Restic snapshot ID" ;;
	*)
		[ "${#SNAPSHOT}" -ge 8 ] && [ "${#SNAPSHOT}" -le 64 ] \
			|| die "--snapshot must be latest or an 8-64 character hexadecimal Restic snapshot ID"
		;;
esac

CURRENT_HOST=$(hostname)
SOURCE_HOST=${SOURCE_HOST:-$CURRENT_HOST}
validate_hostname "$CURRENT_HOST" "Current hostname"
validate_hostname "$SOURCE_HOST" "--source-host"
if [ "$SOURCE_HOST" != "$CURRENT_HOST" ] && [ "$ALLOW_CROSS_HOST" -ne 1 ]; then
	die "Cross-host restore requires --allow-cross-host"
fi
if [ "$ALLOW_CROSS_HOST" -eq 1 ] && [ "$SOURCE_HOST_EXPLICIT" -ne 1 ]; then
	die "Cross-host restore requires --source-host HOST"
fi

RESTORE_ROOT=$(mktemp -d "$BACKUP_DIR/.restore.XXXXXX")

cleanup() {
	exit_status=$?
	trap - EXIT
	set +e
	cleanup_sensitive_file
	rm -rf "$RESTORE_ROOT"
	if [ "$CONFIRMED_RESTORE_STARTED" -eq 1 ]; then
		if ! compose stop --timeout "$OPS_STOP_TIMEOUT_SECONDS" n8n codex-worker >/dev/null 2>&1; then
			printf 'ERROR: Could not keep n8n and codex-worker stopped after restore.\n' >&2
			exit_status=1
		fi
	fi
	if [ "$MAINTENANCE_LOCK_HELD" -eq 1 ]; then
		if [ "$RESTORE_SUCCEEDED" -eq 1 ] && [ "$exit_status" -eq 0 ]; then
			if ! release_maintenance_lock; then
				printf 'ERROR: Could not release maintenance lock: %s\n' "$MAINTENANCE_LOCK_DIR" >&2
				exit_status=1
			fi
		else
			printf 'ERROR: Confirmed restore did not finish; maintenance lock retained: %s\n' "$MAINTENANCE_LOCK_DIR" >&2
		fi
	fi
	exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

log "Restoring snapshot $SNAPSHOT into an isolated validation directory."
if [ "$SNAPSHOT" = latest ]; then
	restic restore --host "$SOURCE_HOST" --tag "$BACKUP_TAG" --target "$RESTORE_ROOT" -- latest
else
	restic restore --target "$RESTORE_ROOT" -- "$SNAPSHOT"
fi

manifest_list=$RESTORE_ROOT/.manifest-list
find "$RESTORE_ROOT" -type f -name manifest.sha256 -print >"$manifest_list"
manifest_count=$(awk 'END {print NR + 0}' "$manifest_list")
[ "$manifest_count" -eq 1 ] || die "Expected one backup payload, found $manifest_count"
manifest_path=$(awk 'NR == 1 {print; exit}' "$manifest_list")
PAYLOAD_DIR=$(dirname -- "$manifest_path")

log "Validating restored dump, archives, manifest and encrypted environment."
validate_payload "$PAYLOAD_DIR"
metadata_file=$PAYLOAD_DIR/backup-metadata.txt
metadata_version=$(awk -F= '$1 == "format_version" {print substr($0, index($0, "=") + 1); exit}' "$metadata_file")
metadata_tag=$(awk -F= '$1 == "backup_tag" {print substr($0, index($0, "=") + 1); exit}' "$metadata_file")
metadata_host=$(awk -F= '$1 == "source_host" {print substr($0, index($0, "=") + 1); exit}' "$metadata_file")
metadata_project=$(awk -F= '$1 == "project_id" {print substr($0, index($0, "=") + 1); exit}' "$metadata_file")
[ "$metadata_version" = 1 ] || die "Unsupported or legacy backup metadata version"
[ "$metadata_tag" = "$BACKUP_TAG" ] || die "Backup tag does not match this automation environment"
[ "$metadata_project" = "$BACKUP_PROJECT_ID" ] || die "Backup project identity does not match BACKUP_PROJECT_ID"
validate_hostname "$metadata_host" "Backup metadata source hostname"
if [ "$SNAPSHOT" = latest ] || [ "$SOURCE_HOST_EXPLICIT" -eq 1 ]; then
	[ "$metadata_host" = "$SOURCE_HOST" ] || die "Restored snapshot source host does not match --source-host"
fi
if [ "$metadata_host" != "$CURRENT_HOST" ] && [ "$ALLOW_CROSS_HOST" -ne 1 ]; then
	die "Snapshot belongs to $metadata_host; use --allow-cross-host for explicit disaster recovery"
fi

if [ "$CONFIRM" -ne 1 ]; then
	log "Dry run passed. No services, volumes, database or environment file were changed."
	log "Run again with --confirm to let the restore stop application services and apply the validated payload."
	exit 0
fi

log "Confirmed restore: stopping n8n and codex-worker before changing persistent data."
acquire_maintenance_lock restore
write_maintenance_marker restore 1
CONFIRMED_RESTORE_STARTED=1
compose stop --timeout "$OPS_STOP_TIMEOUT_SECONDS" n8n codex-worker
assert_service_stopped n8n
assert_service_stopped codex-worker
assert_service_running postgres

n8n_container=$(assert_service_container_exists n8n)
worker_container=$(assert_service_container_exists codex-worker)

log "Restoring PostgreSQL database. Keep n8n and codex-worker stopped if any later step fails."
assert_service_stopped n8n
assert_service_stopped codex-worker
assert_service_running postgres
	case "${POSTGRES_DB:-n8n}" in
		postgres | template0 | template1) die "POSTGRES_DB cannot be a PostgreSQL maintenance database during restore" ;;
	esac
compose exec -T postgres sh -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 --set=target_db="$POSTGRES_DB" --set=target_owner="$POSTGRES_USER"' <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_db' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS :"target_db";
CREATE DATABASE :"target_db" OWNER :"target_owner";
SQL
assert_service_stopped n8n
assert_service_stopped codex-worker
assert_service_running postgres
compose exec -T postgres sh -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
	<"$PAYLOAD_DIR/postgres.dump"

log "Replacing n8n_data from the validated archive."
assert_service_stopped n8n
assert_service_stopped codex-worker
docker run --rm --network none \
	--volumes-from "$n8n_container" \
	-v "$PAYLOAD_DIR:/restore:ro" \
	"$BACKUP_HELPER_IMAGE" \
	sh -eu -c 'find /home/node/.n8n -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /restore/n8n_data.tar.gz -C /home/node/.n8n'

log "Replacing worker_data from the validated archive."
assert_service_stopped n8n
assert_service_stopped codex-worker
docker run --rm --network none \
	--volumes-from "$worker_container" \
	-v "$PAYLOAD_DIR:/restore:ro" \
	"$BACKUP_HELPER_IMAGE" \
	sh -eu -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /restore/worker_data.tar.gz -C /data'

log "Restoring the encrypted automation environment with mode 0600."
assert_service_stopped n8n
assert_service_stopped codex-worker
SENSITIVE_TMP=$ENV_FILE.restore.$$
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
	-pass env:RESTIC_PASSWORD \
	-in "$PAYLOAD_DIR/automation.env.enc" \
	-out "$SENSITIVE_TMP"
[ "$(hash_value "$SENSITIVE_TMP")" = "$(awk 'NR == 1 {print $1}' "$PAYLOAD_DIR/automation.env.plain.sha256")" ] \
	|| die "Restored environment hash does not match"
chmod 600 "$SENSITIVE_TMP"
mv "$SENSITIVE_TMP" "$ENV_FILE"
SENSITIVE_TMP=

RESTORE_SUCCEEDED=1
log "Restore completed. Review $ENV_FILE, then start n8n and codex-worker explicitly."

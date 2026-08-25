#!/bin/sh

set -eu

OPS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=./lib.sh
. "$OPS_DIR/lib.sh"

usage() {
	cat <<'EOF'
Usage: ./ops/backup.sh [--env-file PATH]

Creates and validates a PostgreSQL custom dump, n8n_data archive, filtered
worker_data archive and encrypted automation .env, then stores them in Restic.
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--env-file)
			[ "$#" -ge 2 ] || die "--env-file requires a path"
			ENV_FILE=$2
			shift 2
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

STAGING_ROOT=$BACKUP_DIR/staging
PARTIAL_STAGE=
FINAL_STAGE=
BACKUP_SUCCEEDED=0
SERVICE_STATE_CAPTURED=0
SERVICES_RESTORED=0
N8N_WAS_RUNNING=0
WORKER_WAS_RUNNING=0

restore_one_service() {
	service_name=$1
	was_running=$2
	current_state=$(service_runtime_state "$service_name")
	if [ "$was_running" -eq 1 ]; then
		if [ "$current_state" != running ]; then
			if [ "$current_state" != stopped ]; then
				compose stop --timeout "$OPS_STOP_TIMEOUT_SECONDS" "$service_name" || return 1
			fi
			compose start "$service_name" || return 1
		fi
		[ "$(service_runtime_state "$service_name")" = running ] || return 1
	else
		if [ "$current_state" != stopped ]; then
			compose stop --timeout "$OPS_STOP_TIMEOUT_SECONDS" "$service_name" || return 1
		fi
		[ "$(service_runtime_state "$service_name")" = stopped ] || return 1
	fi
}

restore_original_service_state() {
	[ "$SERVICE_STATE_CAPTURED" -eq 1 ] || return 0
	restore_failed=0
	if ! restore_one_service n8n "$N8N_WAS_RUNNING"; then
		log "Could not restore n8n to its pre-backup state."
		restore_failed=1
	fi
	if ! restore_one_service codex-worker "$WORKER_WAS_RUNNING"; then
		log "Could not restore codex-worker to its pre-backup state."
		restore_failed=1
	fi
	[ "$restore_failed" -eq 0 ] || return 1
	SERVICES_RESTORED=1
}

cleanup() {
	exit_status=$?
	trap - EXIT
	set +e
	cleanup_restore_failed=0
	cleanup_sensitive_file
	if [ "$BACKUP_SUCCEEDED" -ne 1 ]; then
		[ -z "$PARTIAL_STAGE" ] || rm -rf "$PARTIAL_STAGE"
		[ -z "$FINAL_STAGE" ] || rm -rf "$FINAL_STAGE"
	fi
	if [ "$SERVICES_RESTORED" -ne 1 ] && ! restore_original_service_state; then
		printf 'ERROR: Backup cleanup could not restore the original service state.\n' >&2
		exit_status=1
		cleanup_restore_failed=1
	fi
	if [ "$cleanup_restore_failed" -eq 0 ]; then
		if ! release_maintenance_lock; then
			printf 'ERROR: Could not release maintenance lock: %s\n' "$MAINTENANCE_LOCK_DIR" >&2
			exit_status=1
		fi
	else
		printf 'ERROR: Maintenance lock retained for operator inspection: %s\n' "$MAINTENANCE_LOCK_DIR" >&2
	fi
	exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "$STAGING_ROOT"
acquire_maintenance_lock backup
BACKUP_SOURCE_HOST=$(hostname)
validate_hostname "$BACKUP_SOURCE_HOST" "Backup source hostname"

assert_service_running postgres
n8n_container=$(assert_service_container_exists n8n)
worker_container=$(assert_service_container_exists codex-worker)

case "$(service_runtime_state n8n)" in
	running) N8N_WAS_RUNNING=1 ;;
	stopped) N8N_WAS_RUNNING=0 ;;
	*) die "n8n must be stably running or stopped before backup" ;;
esac
case "$(service_runtime_state codex-worker)" in
	running) WORKER_WAS_RUNNING=1 ;;
	stopped) WORKER_WAS_RUNNING=0 ;;
	*) die "codex-worker must be stably running or stopped before backup" ;;
esac
SERVICE_STATE_CAPTURED=1

log "Stopping n8n and codex-worker for a point-in-time-consistent capture."
write_maintenance_marker backup 1
compose stop --timeout "$OPS_STOP_TIMEOUT_SECONDS" n8n codex-worker
assert_service_stopped n8n
assert_service_stopped codex-worker
assert_service_running postgres

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
PARTIAL_STAGE=$STAGING_ROOT/.partial-$timestamp-$$
FINAL_STAGE=$STAGING_ROOT/$timestamp-$$
mkdir "$PARTIAL_STAGE"

log "Creating PostgreSQL custom-format dump."
compose exec -T postgres sh -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
	>"$PARTIAL_STAGE/postgres.dump"

log "Archiving n8n_data."
docker run --rm --read-only --network none \
	--volumes-from "$n8n_container:ro" \
	"$BACKUP_HELPER_IMAGE" \
	tar -C /home/node/.n8n -czf - . >"$PARTIAL_STAGE/n8n_data.tar.gz"

log "Archiving worker_data without ephemeral workspaces."
docker run --rm --read-only --network none \
	--volumes-from "$worker_container:ro" \
	"$BACKUP_HELPER_IMAGE" \
	tar -C /data --exclude='./workspaces' --exclude='./workspaces/*' -czf - . \
	>"$PARTIAL_STAGE/worker_data.tar.gz"

log "Encrypting the automation environment file for local staging."
hash_value "$ENV_FILE" >"$PARTIAL_STAGE/automation.env.plain.sha256"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
	-pass env:RESTIC_PASSWORD \
	-in "$ENV_FILE" \
	-out "$PARTIAL_STAGE/automation.env.enc"

cat >"$PARTIAL_STAGE/backup-metadata.txt" <<EOF
format_version=1
created_at=$timestamp
backup_tag=$BACKUP_TAG
source_host=$BACKUP_SOURCE_HOST
project_id=$BACKUP_PROJECT_ID
postgres_format=custom
n8n_data_included=true
worker_data_included=true
worker_workspaces_included=false
codex_auth_included=false
directus_included=false
EOF

write_manifest "$PARTIAL_STAGE" \
	postgres.dump \
	n8n_data.tar.gz \
	worker_data.tar.gz \
	automation.env.enc \
	automation.env.plain.sha256 \
	backup-metadata.txt

log "Validating dump, archives, manifest and encrypted environment."
validate_payload "$PARTIAL_STAGE"
mv "$PARTIAL_STAGE" "$FINAL_STAGE"
PARTIAL_STAGE=

log "Local payload is valid; restoring services to their pre-backup state."
restore_original_service_state
write_maintenance_marker backup 0

log "Uploading validated payload to Restic."
restic backup "$FINAL_STAGE" \
	--tag "$BACKUP_TAG" \
	--host "$BACKUP_SOURCE_HOST"

log "Applying Restic retention: 7 daily, 5 weekly, 12 monthly."
restic forget \
	--tag "$BACKUP_TAG" \
	--group-by host,tags \
	--keep-daily 7 \
	--keep-weekly 5 \
	--keep-monthly 12 \
	--prune

RESTIC_CHECK_SUBSET=${RESTIC_CHECK_SUBSET:-100%}
log "Running the final Restic repository check (data subset: $RESTIC_CHECK_SUBSET)."
restic check --read-data-subset="$RESTIC_CHECK_SUBSET"

log "Keeping the newest three validated local staging copies."
local_index=0
find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' -print \
	| sort -r \
	| while IFS= read -r old_stage; do
		local_index=$((local_index + 1))
		if [ "$local_index" -gt 3 ]; then
			rm -rf "$old_stage"
		fi
	done

completed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
printf '{"completedAt":"%s","validation":"restic-check-passed"}\n' "$completed_at" \
	| docker run --rm -i --read-only --network none --cap-drop ALL \
		--security-opt no-new-privileges:true \
		--user 1000:1000 \
		--volumes-from "$worker_container" \
		--entrypoint sh "$(docker inspect --format '{{.Config.Image}}' "$worker_container")" -eu -c '
		mkdir -p /data/operations
		temporary=/data/operations/last-backup.json.$$.tmp
		cat >"$temporary"
		chmod 600 "$temporary"
		mv "$temporary" /data/operations/last-backup.json
	'

BACKUP_SUCCEEDED=1
log "Backup completed successfully: $FINAL_STAGE"

#!/bin/sh

# Shared helpers for the automation backup and restore scripts.

set -eu

umask 077

OPS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
AUTOMATION_DIR=$(CDPATH= cd -- "$OPS_DIR/.." && pwd -P)
ENV_FILE=${AUTOMATION_ENV_FILE:-$AUTOMATION_DIR/.env}

BACKUP_TAG=${BACKUP_TAG:-content-ops}
BACKUP_HELPER_IMAGE=${BACKUP_HELPER_IMAGE:-alpine:3.20}
BACKUP_POSTGRES_IMAGE=${BACKUP_POSTGRES_IMAGE:-postgres:16-alpine}
SENSITIVE_TMP=
MAINTENANCE_LOCK_HELD=0

log() {
	printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"
}

file_mode() {
	stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_owner_uid() {
	stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"
}

validate_hostname() {
	hostname_value=$1
	hostname_label=${2:-Hostname}
	case "$hostname_value" in
		'' | *[!a-zA-Z0-9._-]*) die "$hostname_label may contain only letters, digits, dot, underscore and hyphen" ;;
	esac
	[ "${#hostname_value}" -le 253 ] || die "$hostname_label is too long"
}

canonicalize_environment_file() {
	[ -f "$ENV_FILE" ] || die "Environment file not found: $ENV_FILE"
	[ ! -L "$ENV_FILE" ] || die "Environment file must not be a symbolic link: $ENV_FILE"
	env_directory=$(CDPATH= cd -- "$(dirname -- "$ENV_FILE")" && pwd -P)
	ENV_FILE=$env_directory/$(basename -- "$ENV_FILE")
	env_mode=$(file_mode "$ENV_FILE")
	case "$env_mode" in
		400 | 600) ;;
		*) die "Environment file permissions must be 0600 or 0400, got $env_mode: $ENV_FILE" ;;
	esac
	[ "$(file_owner_uid "$ENV_FILE")" = "$(id -u)" ] || die "Environment file must be owned by the current user: $ENV_FILE"
}

load_backup_environment() {
	canonicalize_environment_file

	# automation/.env is an operator-owned file. Keep values shell-compatible
	# (KEY=value), as in .env.example and ops/backup.env.example.
	# shellcheck disable=SC1090
	. "$ENV_FILE"

	: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY in $ENV_FILE}"
	: "${RESTIC_PASSWORD:?Set RESTIC_PASSWORD in $ENV_FILE}"
	: "${AWS_ACCESS_KEY_ID:?Set AWS_ACCESS_KEY_ID in $ENV_FILE}"
	: "${AWS_SECRET_ACCESS_KEY:?Set AWS_SECRET_ACCESS_KEY in $ENV_FILE}"
	: "${BACKUP_DIR:?Set BACKUP_DIR in $ENV_FILE}"

	case "$BACKUP_DIR" in
		/*) ;;
		*) die "BACKUP_DIR must be an absolute path" ;;
	esac

	mkdir -p "$BACKUP_DIR"
	BACKUP_DIR=$(CDPATH= cd -- "$BACKUP_DIR" && pwd -P)
	RESTIC_CACHE_DIR=${RESTIC_CACHE_DIR:-$BACKUP_DIR/restic-cache}
	AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-auto}
	OPS_STOP_TIMEOUT_SECONDS=${OPS_STOP_TIMEOUT_SECONDS:-60}
	BACKUP_PROJECT_ID=${BACKUP_PROJECT_ID:-${COMPOSE_PROJECT_NAME:-$(basename -- "$AUTOMATION_DIR")}}
	case "$BACKUP_PROJECT_ID" in
		'' | *[!a-zA-Z0-9._-]*) die "BACKUP_PROJECT_ID may contain only letters, digits, dot, underscore and hyphen" ;;
	esac
	[ "${#BACKUP_PROJECT_ID}" -le 100 ] || die "BACKUP_PROJECT_ID is too long"
	case "$OPS_STOP_TIMEOUT_SECONDS" in
		'' | *[!0-9]*) die "OPS_STOP_TIMEOUT_SECONDS must be a positive integer" ;;
	esac
	[ "$OPS_STOP_TIMEOUT_SECONDS" -gt 0 ] || die "OPS_STOP_TIMEOUT_SECONDS must be a positive integer"
	mkdir -p "$RESTIC_CACHE_DIR"
	MAINTENANCE_LOCK_DIR=${MAINTENANCE_LOCK_DIR:-$BACKUP_DIR/.maintenance.lock}
	MAINTENANCE_MARKER_FILE=${MAINTENANCE_MARKER_FILE:-$BACKUP_DIR/maintenance.state}
	case "$MAINTENANCE_LOCK_DIR" in
		/*) ;;
		*) die "MAINTENANCE_LOCK_DIR must be an absolute path" ;;
	esac
	case "$MAINTENANCE_MARKER_FILE" in
		/*) ;;
		*) die "MAINTENANCE_MARKER_FILE must be an absolute path" ;;
	esac

	# Export only the values required by Restic/OpenSSL. Application tokens from
	# automation/.env stay out of unrelated child-process environments; Compose
	# reads them directly from --env-file when needed.
	export RESTIC_REPOSITORY RESTIC_PASSWORD RESTIC_CACHE_DIR
	export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
}

write_maintenance_marker() {
	operation=$1
	suppress_health=$2
	[ "$MAINTENANCE_LOCK_HELD" -eq 1 ] || die "Maintenance lock is not held"
	case "$operation" in
		backup | restore) ;;
		*) die "Unsupported maintenance operation: $operation" ;;
	esac
	case "$suppress_health" in
		0 | 1) ;;
		*) die "suppress_health must be 0 or 1" ;;
	esac
	maintenance_host=$(hostname)
	validate_hostname "$maintenance_host" "Maintenance hostname"
	marker_directory=$(dirname -- "$MAINTENANCE_MARKER_FILE")
	mkdir -p "$marker_directory"
	marker_temporary=$MAINTENANCE_MARKER_FILE.$$.tmp
	{
		printf 'operation=%s\n' "$operation"
		printf 'pid=%s\n' "$$"
		printf 'started_epoch=%s\n' "$(date '+%s')"
		printf 'host=%s\n' "$maintenance_host"
		printf 'suppress_health=%s\n' "$suppress_health"
	} >"$marker_temporary"
	chmod 600 "$marker_temporary"
	mv "$marker_temporary" "$MAINTENANCE_MARKER_FILE"
}

acquire_maintenance_lock() {
	operation=$1
	if ! mkdir "$MAINTENANCE_LOCK_DIR" 2>/dev/null; then
		die "Another backup or confirmed restore is active: $MAINTENANCE_LOCK_DIR"
	fi
	MAINTENANCE_LOCK_HELD=1
	write_maintenance_marker "$operation" 0
}

release_maintenance_lock() {
	[ "$MAINTENANCE_LOCK_HELD" -eq 1 ] || return 0
	rm -f "$MAINTENANCE_MARKER_FILE"
	if ! rmdir "$MAINTENANCE_LOCK_DIR" 2>/dev/null; then
		return 1
	fi
	MAINTENANCE_LOCK_HELD=0
}

compose() {
	docker compose --env-file "$ENV_FILE" -f "$AUTOMATION_DIR/docker-compose.yml" "$@"
}

hash_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1"
	else
		shasum -a 256 "$1"
	fi
}

hash_value() {
	hash_file "$1" | awk '{print $1}'
}

write_manifest() {
	payload_dir=$1
	shift
	(
		cd "$payload_dir"
		: >manifest.sha256
		for payload_file in "$@"; do
			hash_file "$payload_file" >>manifest.sha256
		done
	)
}

verify_manifest() {
	payload_dir=$1
	(
		cd "$payload_dir"
		[ -f manifest.sha256 ] || die "manifest.sha256 is missing"
		if command -v sha256sum >/dev/null 2>&1; then
			sha256sum -c manifest.sha256 >/dev/null
		else
			shasum -a 256 -c manifest.sha256 >/dev/null
		fi
	)
}

validate_payload() {
	payload_dir=$1

	for required_file in \
		postgres.dump \
		n8n_data.tar.gz \
		worker_data.tar.gz \
		automation.env.enc \
		automation.env.plain.sha256 \
		backup-metadata.txt \
		manifest.sha256; do
		[ -s "$payload_dir/$required_file" ] || die "Backup payload is missing or empty: $required_file"
	done

	verify_manifest "$payload_dir"
	tar -tzf "$payload_dir/n8n_data.tar.gz" >/dev/null
	tar -tzf "$payload_dir/worker_data.tar.gz" >/dev/null

	docker run --rm --read-only --network none \
		-v "$payload_dir:/restore:ro" \
		"$BACKUP_POSTGRES_IMAGE" \
		pg_restore --list /restore/postgres.dump >/dev/null

	SENSITIVE_TMP=$(mktemp "$BACKUP_DIR/.env-validation.XXXXXX")
	openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
		-pass env:RESTIC_PASSWORD \
		-in "$payload_dir/automation.env.enc" \
		-out "$SENSITIVE_TMP"
	expected_env_hash=$(awk 'NR == 1 {print $1}' "$payload_dir/automation.env.plain.sha256")
	actual_env_hash=$(hash_value "$SENSITIVE_TMP")
	[ -n "$expected_env_hash" ] || die "Encrypted environment hash is empty"
	[ "$actual_env_hash" = "$expected_env_hash" ] || die "Encrypted environment validation failed"
	rm -f "$SENSITIVE_TMP"
	SENSITIVE_TMP=
}

cleanup_sensitive_file() {
	if [ -n "$SENSITIVE_TMP" ] && [ -e "$SENSITIVE_TMP" ]; then
		rm -f "$SENSITIVE_TMP"
	fi
	SENSITIVE_TMP=
}

assert_repository_ready() {
	if ! restic snapshots >/dev/null 2>&1; then
		die "Restic repository is unavailable or uninitialized. Run automation/ops/init-restic.sh first."
	fi
}

container_id_for_service() {
	compose ps -a -q "$1" | awk 'NR == 1 {print; exit}'
}

assert_service_container_exists() {
	service_name=$1
	container_id=$(container_id_for_service "$service_name")
	[ -n "$container_id" ] || die "Compose container does not exist for service: $service_name"
	printf '%s\n' "$container_id"
}

assert_service_running() {
	service_name=$1
	container_id=$(assert_service_container_exists "$service_name")
	runtime_state=$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.State.Paused}}' "$container_id")
	[ "$runtime_state" = 'true false false' ] || die "Compose service must be stably running: $service_name ($runtime_state)"
}

assert_service_stopped() {
	service_name=$1
	container_id=$(assert_service_container_exists "$service_name")
	runtime_state=$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.State.Paused}}' "$container_id")
	[ "$runtime_state" = 'false false false' ] || die "Compose service must be stably stopped: $service_name ($runtime_state)"
}

service_runtime_state() {
	service_name=$1
	if ! container_id=$(container_id_for_service "$service_name"); then
		printf '%s\n' unavailable
		return 0
	fi
	if [ -z "$container_id" ]; then
		printf '%s\n' missing
		return 0
	fi
	if ! runtime_state=$(docker inspect --format '{{.State.Running}} {{.State.Restarting}} {{.State.Paused}}' "$container_id" 2>/dev/null); then
		printf '%s\n' unavailable
		return 0
	fi
	case "$runtime_state" in
		'true false false') printf '%s\n' running ;;
		'false false false') printf '%s\n' stopped ;;
		*) printf '%s\n' unstable ;;
	esac
}

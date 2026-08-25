#!/bin/sh

set -eu

OPS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=./lib.sh
. "$OPS_DIR/lib.sh"

usage() {
	cat <<'EOF'
Usage: ./ops/init-restic.sh [--env-file PATH]

Initializes the configured Restic repository. Existing repositories are left
unchanged. The environment file defaults to automation/.env.
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

require_command restic
load_backup_environment

if restic snapshots >/dev/null 2>&1; then
	log "Restic repository is already initialized."
	restic check
	exit 0
fi

log "Initializing encrypted Restic repository at $RESTIC_REPOSITORY"
restic init
restic check
log "Restic repository initialized and checked."

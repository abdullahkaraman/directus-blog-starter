#!/bin/sh

set -eu
umask 077

secret_dir=/tmp/worker-secrets
mkdir -p "$secret_dir"
chmod 700 "$secret_dir"

write_secret() {
	name=$1
	value=$2
	[ -n "$value" ] || return 0
	file=$secret_dir/$name
	printf '%s' "$value" >"$file"
	chmod 400 "$file"
	case "$name" in
		WORKER_API_TOKEN) export WORKER_API_TOKEN_FILE=$file ;;
		DIRECTUS_TOKEN) export DIRECTUS_TOKEN_FILE=$file ;;
		DRAFT_PREVIEW_SECRET) export DRAFT_PREVIEW_SECRET_FILE=$file ;;
		N8N_CALLBACK_TOKEN) export N8N_CALLBACK_TOKEN_FILE=$file ;;
		*) return 1 ;;
	esac
}

write_secret WORKER_API_TOKEN "${WORKER_API_TOKEN:-}"
write_secret DIRECTUS_TOKEN "${DIRECTUS_TOKEN:-}"
write_secret DRAFT_PREVIEW_SECRET "${DRAFT_PREVIEW_SECRET:-}"
write_secret N8N_CALLBACK_TOKEN "${N8N_CALLBACK_TOKEN:-}"

unset WORKER_API_TOKEN DIRECTUS_TOKEN DRAFT_PREVIEW_SECRET N8N_CALLBACK_TOKEN

if [ "${1:-}" = node ] && [ "${2:-}" = src/server.mjs ]; then
	exec "$@"
fi

# Maintenance commands such as `codex login` do not need application secrets
# and must write the shared Codex volume as the runtime node user.
rm -f "$secret_dir"/*
rmdir "$secret_dir"
unset WORKER_API_TOKEN_FILE DIRECTUS_TOKEN_FILE DRAFT_PREVIEW_SECRET_FILE N8N_CALLBACK_TOKEN_FILE
exec setpriv --reuid=1000 --regid=1000 --clear-groups --no-new-privs "$@"

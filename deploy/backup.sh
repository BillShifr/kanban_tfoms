#!/bin/sh
set -eu
umask 077

: "${ENV_FILE:?ENV_FILE is required}"
[ -r "$ENV_FILE" ] || { echo "environment file is not readable: $ENV_FILE" >&2; exit 1; }
set -a
. "$ENV_FILE"
set +a
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${UPLOADS_DIR:?UPLOADS_DIR is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"

PODMAN=${PODMAN:-podman}
COMPOSE_FILE=${COMPOSE_FILE:-compose.prod.yml}

require_safe_absolute_dir() {
  case "$1" in /*) ;; *) echo "path must be absolute: $1" >&2; exit 1 ;; esac
  [ "$1" != / ] || { echo "refusing to use / as a data path" >&2; exit 1; }
}

require_safe_absolute_dir "$UPLOADS_DIR"
require_safe_absolute_dir "$BACKUP_DIR"
[ -d "$UPLOADS_DIR" ] || { echo "uploads directory does not exist: $UPLOADS_DIR" >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_set="$BACKUP_DIR/kanban-$stamp"
mkdir -p "$BACKUP_DIR"
mkdir "$backup_set" || { echo "backup destination already exists: $backup_set" >&2; exit 1; }

api_stopped=false
cleanup_running=false
start_api() {
  if [ "$api_stopped" = true ]; then
    "$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api
    api_stopped=false
  fi
}
cleanup() {
  status=$?
  [ "$cleanup_running" = false ] || exit "$status"
  cleanup_running=true
  trap - EXIT HUP INT TERM
  start_api || status=1
  exit "$status"
}
signal_exit() { exit "$1"; }
trap cleanup EXIT
trap 'signal_exit 129' HUP
trap 'signal_exit 130' INT
trap 'signal_exit 143' TERM

# Quiescing writes makes the database dump and uploads archive one backup set.
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops pull db-tools
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api
api_stopped=true
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops \
  run --rm --no-deps -T db-tools sh -c \
  'pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"' \
  > "$backup_set/database.dump"
"$PODMAN" unshare tar -C "$UPLOADS_DIR" -cf "$backup_set/uploads.tar" .
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops \
  run --rm --no-deps -T db-tools pg_restore --list \
  < "$backup_set/database.dump" >/dev/null
"$PODMAN" unshare tar -tf "$backup_set/uploads.tar" >/dev/null
(
  cd "$backup_set"
  sha256sum database.dump uploads.tar > SHA256SUMS
  printf '%s\n' "$stamp" > CREATED_AT_UTC
)
echo "backup created: $backup_set"

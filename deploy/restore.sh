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
: "${BACKUP_SET:?BACKUP_SET is required}"
: "${CONFIRM_RESTORE:?Set CONFIRM_RESTORE=YES after checking the target database}"
[ "$CONFIRM_RESTORE" = YES ] || { echo "restore not confirmed; set CONFIRM_RESTORE=YES" >&2; exit 1; }

PODMAN=${PODMAN:-podman}
COMPOSE_FILE=${COMPOSE_FILE:-compose.prod.yml}
RESTART_API_AFTER_RESTORE=${RESTART_API_AFTER_RESTORE:-true}
state_dir=${AUTODEPLOY_STATE_DIR:-"$HOME/.local/state/minimal-kanban"}
lock_file="$state_dir/lifecycle.lock"
lifecycle_lock_held=${LIFECYCLE_LOCK_HELD:-false}
[ "$RESTART_API_AFTER_RESTORE" = true ] || [ "$RESTART_API_AFTER_RESTORE" = false ] || {
  echo "RESTART_API_AFTER_RESTORE must be true or false" >&2
  exit 1
}
case "$lifecycle_lock_held" in true | false) ;; *)
  echo "LIFECYCLE_LOCK_HELD must be true or false" >&2
  exit 1
esac
if [ "$lifecycle_lock_held" = false ]; then
  command -v flock >/dev/null 2>&1 || {
    echo "required command is missing: flock" >&2
    exit 1
  }
  mkdir -p "$state_dir"
  exec 9>"$lock_file"
  flock -w 60 9 || {
    echo "another lifecycle operation is still running" >&2
    exit 1
  }
fi

require_safe_absolute_dir() {
  case "$1" in /*) ;; *) echo "path must be absolute: $1" >&2; exit 1 ;; esac
  [ "$1" != / ] || { echo "refusing to use / as a data path" >&2; exit 1; }
}
require_safe_absolute_dir "$UPLOADS_DIR"
require_safe_absolute_dir "$BACKUP_SET"
[ -f "$BACKUP_SET/database.dump" ] || { echo "database.dump is missing" >&2; exit 1; }
[ -f "$BACKUP_SET/uploads.tar" ] || { echo "uploads.tar is missing" >&2; exit 1; }
[ -f "$BACKUP_SET/SHA256SUMS" ] || { echo "SHA256SUMS is missing" >&2; exit 1; }
(
  cd "$BACKUP_SET"
  sha256sum -c SHA256SUMS
)

# Reject absolute and parent-traversal names before extracting a trusted backup.
if tar -tf "$BACKUP_SET/uploads.tar" | while IFS= read -r member; do
  case "$member" in /*|../*|*/../*|..) exit 1 ;; esac
done
then :; else
  echo "uploads archive contains an unsafe member name" >&2
  exit 1
fi

parent_dir=$(dirname "$UPLOADS_DIR")
base_name=$(basename "$UPLOADS_DIR")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
staging_dir="$parent_dir/.${base_name}.restore-$stamp-$$"
previous_dir="$parent_dir/.${base_name}.pre-restore-$stamp"
[ -d "$parent_dir" ] || { echo "uploads parent directory does not exist: $parent_dir" >&2; exit 1; }
mkdir "$staging_dir"
"$PODMAN" unshare tar -C "$staging_dir" -xf "$BACKUP_SET/uploads.tar"
"$PODMAN" unshare chown -R 1000:1000 "$staging_dir"

api_stopped=false
restart_allowed=true
cleanup_running=false
start_api() {
  if [ "$api_stopped" = true ] && [ "$restart_allowed" = true ] && \
    [ "$RESTART_API_AFTER_RESTORE" = true ]; then
    "$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
      up -d --no-deps api
    api_stopped=false
  fi
}
cleanup() {
  status=$?
  [ "$cleanup_running" = false ] || exit "$status"
  cleanup_running=true
  trap - EXIT HUP INT TERM
  if ! start_api; then status=1; fi
  if [ "$api_stopped" = true ]; then
    echo "API remains stopped; inspect database/uploads consistency before starting it" >&2
  fi
  exit "$status"
}
signal_exit() { exit "$1"; }
trap cleanup EXIT
trap 'signal_exit 129' HUP
trap 'signal_exit 130' INT
trap 'signal_exit 143' TERM
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops pull db-tools
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api
api_stopped=true

# Prove that the uploads directory can be atomically moved before changing the database.
rename_probe="$parent_dir/.${base_name}.rename-probe-$stamp-$$"
if [ -e "$UPLOADS_DIR" ]; then
  mv "$UPLOADS_DIR" "$rename_probe"
  mv "$rename_probe" "$UPLOADS_DIR"
fi

# This overwrites the configured database only after the explicit confirmation above.
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops \
  run --rm --no-deps -T db-tools sh -c \
  'pg_restore --clean --if-exists --single-transaction --no-owner --no-privileges --dbname="$DATABASE_URL"' \
  < "$BACKUP_SET/database.dump"
restart_allowed=false
if [ -e "$UPLOADS_DIR" ]; then mv "$UPLOADS_DIR" "$previous_dir"; fi
mv "$staging_dir" "$UPLOADS_DIR"
restart_allowed=true
echo "restore completed; previous uploads retained at: $previous_dir"

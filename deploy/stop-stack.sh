#!/bin/sh
set -eu

env_file=${ENV_FILE:-"$HOME/.config/kanban/api.env"}
podman=${PODMAN:-podman}
compose_file=${COMPOSE_FILE:-compose.prod.yml}
compose_timeout=${COMPOSE_COMMAND_TIMEOUT_SECONDS:-120}
state_dir=${AUTODEPLOY_STATE_DIR:-"$HOME/.local/state/minimal-kanban"}
lock_file="$state_dir/lifecycle.lock"
lifecycle_lock_held=${LIFECYCLE_LOCK_HELD:-false}

fail() {
  echo "stop-stack: $*" >&2
  exit 1
}

for command_name in "$podman" flock timeout; do
  command -v "$command_name" >/dev/null 2>&1 || \
    fail "required command is missing: $command_name"
done
[ -r "$env_file" ] || fail "environment file is not readable: $env_file"
case "$lifecycle_lock_held" in true | false) ;; *) fail "LIFECYCLE_LOCK_HELD must be true or false" ;; esac

if [ "$lifecycle_lock_held" = false ]; then
  mkdir -p "$state_dir"
  set +e
  LIFECYCLE_LOCK_HELD=true flock -w 60 -E 73 -o "$lock_file" "$0" "$@"
  lock_status=$?
  set -e
  [ "$lock_status" -ne 73 ] || fail "another lifecycle operation is still running"
  exit "$lock_status"
fi

timeout "$compose_timeout" "$podman" compose --env-file "$env_file" \
  -f "$compose_file" down
echo "stop-stack: production stack stopped"

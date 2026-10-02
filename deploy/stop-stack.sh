#!/bin/sh
set -eu

env_file=${ENV_FILE:-"$HOME/.config/kanban/api.env"}
podman=${PODMAN:-podman}
compose_file=${COMPOSE_FILE:-compose.prod.yml}
compose_timeout=${COMPOSE_COMMAND_TIMEOUT_SECONDS:-120}
state_dir=${AUTODEPLOY_STATE_DIR:-"$HOME/.local/state/minimal-kanban"}
lock_file="$state_dir/lifecycle.lock"

fail() {
  echo "stop-stack: $*" >&2
  exit 1
}

for command_name in "$podman" flock timeout; do
  command -v "$command_name" >/dev/null 2>&1 || \
    fail "required command is missing: $command_name"
done
[ -r "$env_file" ] || fail "environment file is not readable: $env_file"

mkdir -p "$state_dir"
exec 9>"$lock_file"
flock -w 60 9 || fail "another lifecycle operation is still running"

timeout "$compose_timeout" "$podman" compose --env-file "$env_file" \
  -f "$compose_file" down
echo "stop-stack: production stack stopped"

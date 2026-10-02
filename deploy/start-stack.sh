#!/bin/sh
set -eu

env_file=${ENV_FILE:-"$HOME/.config/kanban/api.env"}
podman=${PODMAN:-podman}
compose_file=${COMPOSE_FILE:-compose.prod.yml}
build_images=${BUILD_IMAGES:-false}
compose_timeout=${COMPOSE_COMMAND_TIMEOUT_SECONDS:-120}
build_timeout=${BUILD_TIMEOUT_SECONDS:-1200}
inspect_timeout=${INSPECT_TIMEOUT_SECONDS:-10}
health_timeout=${HEALTH_TIMEOUT_SECONDS:-180}
poll_interval=${HEALTH_POLL_INTERVAL_SECONDS:-2}
state_dir=${AUTODEPLOY_STATE_DIR:-"$HOME/.local/state/minimal-kanban"}
lock_file="$state_dir/lifecycle.lock"
lifecycle_lock_held=${LIFECYCLE_LOCK_HELD:-false}

fail() {
  echo "start-stack: $*" >&2
  exit 1
}

for command_name in "$podman" date flock sleep timeout; do
  command -v "$command_name" >/dev/null 2>&1 || \
    fail "required command is missing: $command_name"
done
[ -r "$env_file" ] || fail "environment file is not readable: $env_file"
case "$build_images" in true | false) ;; *) fail "BUILD_IMAGES must be true or false" ;; esac
case "$lifecycle_lock_held" in true | false) ;; *) fail "LIFECYCLE_LOCK_HELD must be true or false" ;; esac

if [ "$lifecycle_lock_held" = false ]; then
  mkdir -p "$state_dir"
  exec 9>"$lock_file"
  flock -w 60 9 || fail "another lifecycle operation is still running"
fi

compose() {
  timeout "$compose_timeout" "$podman" compose --env-file "$env_file" \
    -f "$compose_file" "$@"
}

service_container_id() {
  service=$1
  container_ids=$(compose ps -q "$service") || \
    fail "could not resolve the $service container"
  set -- $container_ids
  [ "$#" -eq 1 ] || fail "expected one $service container, found $#"
  printf '%s\n' "$1"
}

show_service_logs() {
  compose logs --no-color --tail 100 "$1" >&2 || true
}

wait_for_healthy() {
  service=$1
  deadline=$(( $(date +%s) + health_timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    container_id=$(service_container_id "$service")
    if [ -n "$container_id" ]; then
      status=$(
        timeout "$inspect_timeout" "$podman" inspect \
          --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
          "$container_id" 2>/dev/null || true
      )
      case "$status" in
        healthy)
          echo "start-stack: $service is healthy"
          return 0
          ;;
        unhealthy | exited | dead)
          show_service_logs "$service"
          fail "$service entered terminal state: $status"
          ;;
      esac
    fi
    sleep "$poll_interval"
  done
  show_service_logs "$service"
  fail "$service did not become healthy in ${health_timeout}s"
}

compose config >/dev/null
if [ "$build_images" = true ]; then
  timeout "$build_timeout" "$podman" compose --env-file "$env_file" \
    -f "$compose_file" build api web
fi

# podman-compose can block while resolving health-based dependencies for a
# combined `up`. Start each layer explicitly and verify it before continuing.
compose up -d db
wait_for_healthy db
compose up -d --no-deps api
wait_for_healthy api
compose up -d --no-deps web
wait_for_healthy web

echo "start-stack: production stack is healthy"

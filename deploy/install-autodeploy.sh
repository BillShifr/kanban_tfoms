#!/bin/sh
set -eu
umask 077

project_root=${PROJECT_DIR:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}
expected_root=${EXPECTED_PROJECT_DIR:-"$HOME/apps/minimal-kanban"}
env_file=${ENV_FILE:-"$HOME/.config/kanban/api.env"}
user_unit_dir=${SYSTEMD_USER_DIR:-"$HOME/.config/systemd/user"}
state_dir=${AUTODEPLOY_STATE_DIR:-"$HOME/.local/state/minimal-kanban"}
compose_provider=${PODMAN_COMPOSE_PROVIDER:-/usr/bin/podman-compose}

fail() {
  echo "install-autodeploy: $*" >&2
  exit 1
}

for command_name in git install loginctl systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || \
    fail "required command is missing: $command_name"
done
[ "$project_root" = "$expected_root" ] || \
  fail "checkout must be located at $expected_root (got $project_root)"
[ -d "$project_root/.git" ] || fail "project is not a Git checkout: $project_root"
[ -r "$env_file" ] || fail "environment file is not readable: $env_file"
[ -x "$compose_provider" ] || \
  fail "expected Compose provider is missing: $compose_provider"

cd "$project_root"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
current_branch=$(git symbolic-ref --quiet --short HEAD || true)
[ "$current_branch" = main ] || \
  fail "autodeploy must be installed from main (got ${current_branch:-detached HEAD})"

install -d -m 0700 "$user_unit_dir" "$state_dir"
install -m 0644 deploy/systemd/kanban-compose.service \
  "$user_unit_dir/kanban-compose.service"
install -m 0644 deploy/systemd/kanban-autodeploy.service \
  "$user_unit_dir/kanban-autodeploy.service"
install -m 0644 deploy/systemd/kanban-autodeploy.timer \
  "$user_unit_dir/kanban-autodeploy.timer"

systemctl --user daemon-reload
systemctl --user enable kanban-compose.service kanban-autodeploy.timer
systemctl --user start kanban-compose.service
systemctl --user start kanban-autodeploy.timer
systemctl --user start kanban-autodeploy.service

systemctl --user is-active --quiet kanban-compose.service || \
  fail "kanban-compose.service is not active"
systemctl --user is-active --quiet kanban-autodeploy.timer || \
  fail "kanban-autodeploy.timer is not active"

linger=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || true)
if [ "$linger" != yes ]; then
  echo "install-autodeploy: warning: linger is disabled; ask DevOps to run:" >&2
  echo "  sudo loginctl enable-linger $USER" >&2
fi

echo "install-autodeploy: installed and active"
systemctl --user list-timers kanban-autodeploy.timer --all --no-pager

#!/bin/sh
set -eu
umask 077

project_root=${PROJECT_DIR:-$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)}
env_file=${ENV_FILE:-"$HOME/.config/kanban/api.env"}
podman=${PODMAN:-podman}
compose_file=${COMPOSE_FILE:-compose.prod.yml}
verify_url=${VERIFY_URL:-http://127.0.0.1:8080}
remote_name=${DEPLOY_REMOTE:-origin}
deploy_branch=${DEPLOY_BRANCH:-main}
github_repository=${GITHUB_REPOSITORY:-BillShifr/kanban_tfoms}
ci_workflow=${CI_WORKFLOW_NAME:-CI}
state_dir=${AUTODEPLOY_STATE_DIR:-"$HOME/.local/state/minimal-kanban"}
lock_file="$state_dir/lifecycle.lock"

fail() {
  echo "autodeploy: $*" >&2
  exit 1
}

for command_name in curl flock git python3 sed; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done
[ -r "$env_file" ] || fail "environment file is not readable: $env_file"
[ -d "$project_root/.git" ] || fail "project is not a Git checkout: $project_root"

mkdir -p "$state_dir"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "autodeploy: another deployment is already running"
  exit 0
fi

cd "$project_root"
[ -z "$(git status --porcelain)" ] || fail "working tree is not clean"
current_branch=$(git symbolic-ref --quiet --short HEAD || true)
[ "$current_branch" = "$deploy_branch" ] || fail "expected branch $deploy_branch, got ${current_branch:-detached HEAD}"

remote_url=$(git remote get-url "$remote_name")
case "$remote_url" in
  https://github.com/BillShifr/kanban_tfoms.git | git@github.com:BillShifr/kanban_tfoms.git) ;;
  *) fail "unexpected deployment remote: $remote_url" ;;
esac

git fetch --quiet --no-tags "$remote_name" "$deploy_branch"
current_head=$(git rev-parse HEAD)
target_head=$(git rev-parse "$remote_name/$deploy_branch")

image_tag_count=$(grep -c '^IMAGE_TAG=' "$env_file" || true)
[ "$image_tag_count" -eq 1 ] || fail "environment file must contain exactly one IMAGE_TAG"
previous_image_tag=$(sed -n 's/^IMAGE_TAG=//p' "$env_file")
case "$previous_image_tag" in
  '' | *[!A-Za-z0-9_.-]*) fail "current IMAGE_TAG contains unsafe characters" ;;
esac
case "$target_head" in
  *[!0-9a-f]*) fail "target commit is not a hexadecimal SHA" ;;
esac

if [ "$current_head" = "$target_head" ] && [ "$previous_image_tag" = "$target_head" ]; then
  echo "autodeploy: already current at $current_head"
  exit 0
fi

git merge-base --is-ancestor "$current_head" "$target_head" || \
  fail "origin/$deploy_branch is not a fast-forward from $current_head"

ci_response=$(mktemp "$state_dir/ci-response.XXXXXX")
cleanup() { rm -f "$ci_response"; }
trap cleanup EXIT HUP INT TERM

ci_url="https://api.github.com/repos/$github_repository/actions/runs?branch=$deploy_branch&event=push&head_sha=$target_head&per_page=20"
if ! curl --fail --silent --show-error --location \
  --connect-timeout 10 --max-time 30 \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "$ci_url" > "$ci_response"; then
  echo "autodeploy: GitHub CI status is temporarily unavailable; retrying on the next timer run" >&2
  exit 0
fi

set +e
python3 - "$ci_response" "$target_head" "$ci_workflow" <<'PY'
import json
import sys

path, expected_sha, workflow_name = sys.argv[1:]
with open(path, encoding="utf-8") as source:
    payload = json.load(source)

runs = [
    run
    for run in payload.get("workflow_runs", [])
    if run.get("head_sha") == expected_sha
    and run.get("event") == "push"
    and run.get("name") == workflow_name
]
if not runs:
    raise SystemExit(10)

run = max(runs, key=lambda item: (item.get("run_number", 0), item.get("run_attempt", 0)))
if run.get("status") != "completed":
    raise SystemExit(10)
if run.get("conclusion") != "success":
    print(run.get("html_url", ""))
    raise SystemExit(11)
PY
ci_status=$?
set -e

case "$ci_status" in
  0) ;;
  10)
    echo "autodeploy: CI for $target_head is not complete; retrying on the next timer run"
    exit 0
    ;;
  11)
    echo "autodeploy: CI for $target_head did not pass; deployment skipped" >&2
    exit 0
    ;;
  *) fail "could not validate GitHub CI status for $target_head" ;;
esac

set_image_tag() {
  tag=$1
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$tag/" "$env_file"
  [ "$(sed -n 's/^IMAGE_TAG=//p' "$env_file")" = "$tag" ] || \
    fail "could not update IMAGE_TAG"
}

echo "autodeploy: creating a consistent backup before $target_head"
ENV_FILE="$env_file" PODMAN="$podman" COMPOSE_FILE="$compose_file" \
  LIFECYCLE_LOCK_HELD=true \
  "$project_root/deploy/backup.sh"

git merge --ff-only "$remote_name/$deploy_branch"
set_image_tag "$target_head"

deploy_ok=false
if ENV_FILE="$env_file" PODMAN="$podman" COMPOSE_FILE="$compose_file" \
  BUILD_IMAGES=true LIFECYCLE_LOCK_HELD=true \
  "$project_root/deploy/start-stack.sh"; then
  if ENV_FILE="$env_file" PODMAN="$podman" COMPOSE_FILE="$compose_file" \
    VERIFY_URL="$verify_url" "$project_root/deploy/verify.sh"; then
    deploy_ok=true
  fi
fi

if [ "$deploy_ok" = true ]; then
  echo "autodeploy: deployed $target_head"
  exit 0
fi

echo "autodeploy: deployment failed; restoring code and images for $current_head" >&2
git reset --hard "$current_head"
set_image_tag "$previous_image_tag"
ENV_FILE="$env_file" PODMAN="$podman" COMPOSE_FILE="$compose_file" \
  BUILD_IMAGES=false LIFECYCLE_LOCK_HELD=true \
  "$project_root/deploy/start-stack.sh"
ENV_FILE="$env_file" PODMAN="$podman" COMPOSE_FILE="$compose_file" \
  VERIFY_URL="$verify_url" "$project_root/deploy/verify.sh"
fail "deployment of $target_head failed and was rolled back"

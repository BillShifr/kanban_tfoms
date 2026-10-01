#!/bin/sh
set -eu
umask 077

project_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
release_tag=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
output=${1:-"$project_root/minimal-kanban-release-$release_tag.tar.gz"}

case "$output" in
  /*) ;;
  *) output="$PWD/$output" ;;
esac

staging_root=$(mktemp -d "${TMPDIR:-/tmp}/minimal-kanban-release.XXXXXX")
release_root="$staging_root/minimal-kanban-release"
cleanup() { rm -rf "$staging_root"; }
trap cleanup EXIT HUP INT TERM

mkdir "$release_root"
tar -C "$project_root" \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='dist' \
  --exclude='*/dist' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  --exclude='coverage' \
  --exclude='data' \
  --exclude='.env' \
  -cf - \
  .dockerignore .env.production.example .gitignore .prettierignore \
  .prettierrc.json README.md apps compose.prod.yml deploy docs package-lock.json \
  package.json \
  | tar -C "$release_root" -xf -

printf 'IMAGE_TAG=%s\n' "$release_tag" > "$release_root/RELEASE"
(
  cd "$release_root"
  find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | while IFS= read -r file; do
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$file"
    else
      shasum -a 256 "$file"
    fi
  done > SHA256SUMS
)

mkdir -p "$(dirname "$output")"
tar -C "$staging_root" -czf "$output" minimal-kanban-release
printf '%s\n' "$output"

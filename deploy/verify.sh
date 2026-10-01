#!/bin/sh
set -eu

: "${ENV_FILE:?ENV_FILE is required}"
[ -r "$ENV_FILE" ] || { echo "environment file is not readable: $ENV_FILE" >&2; exit 1; }
set -a
. "$ENV_FILE"
set +a
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PUBLIC_URL:?PUBLIC_URL is required}"
PODMAN=${PODMAN:-podman}
COMPOSE_FILE=${COMPOSE_FILE:-compose.prod.yml}

"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  "$PUBLIC_URL/" >/dev/null
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  "$PUBLIC_URL/api/health" >/dev/null
"$PODMAN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile ops \
  run --rm --no-deps -T db-tools sh -c \
  'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select count(*) as applied_migrations from _migrations;"' \
  >/dev/null
echo "production verification passed"

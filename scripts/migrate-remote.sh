#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"
source "$ROOT_DIR/scripts/lib/wrangler-config.sh"

resolve_optional_env_value() {
  local value
  if value="$(resolve_env_value_with_fallbacks "$@")"; then
    printf '%s' "$value"
    return 0
  fi
  printf ''
}

load_root_env "migrate-remote" || true

D1_DATABASE_NAME="$(resolve_optional_env_value "CF_D1_DATABASE_NAME")"
if [[ -z "$D1_DATABASE_NAME" ]]; then
  D1_DATABASE_NAME="smartlamp_db"
fi

WORKER_ENV="$(resolve_optional_env_value "CF_WORKER_ENV")"
MIGRATE_ARGS=("$D1_DATABASE_NAME" --remote)
WRANGLER_CONFIG="$ROOT_DIR/backend/wrangler.toml"
WRANGLER_CONFIG_RUNTIME=""

if [[ ! -f "$WRANGLER_CONFIG" ]]; then
  echo "[migrate-remote] Missing backend/wrangler.toml."
  echo "[migrate-remote] Create it from template:"
  echo "  cp backend/wrangler.toml.example backend/wrangler.toml"
  exit 1
fi

WRANGLER_CONFIG_RUNTIME="$(create_wrangler_runtime_config "$WRANGLER_CONFIG" "migrate-remote")"

cleanup() {
  cleanup_wrangler_runtime_config "$WRANGLER_CONFIG_RUNTIME" "$WRANGLER_CONFIG"
}

trap cleanup EXIT

if [[ -n "$WORKER_ENV" ]]; then
  MIGRATE_ARGS+=(--env "$WORKER_ENV")
  echo "[migrate-remote] Using Worker env: $WORKER_ENV"
fi

echo "[migrate-remote] Applying remote D1 migrations..."
(
  cd "$ROOT_DIR/backend"
  npx wrangler -c "$WRANGLER_CONFIG_RUNTIME" d1 migrations apply "${MIGRATE_ARGS[@]}"
)

echo "[migrate-remote] Done."

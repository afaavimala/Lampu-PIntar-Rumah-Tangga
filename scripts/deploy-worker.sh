#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"
source "$ROOT_DIR/scripts/lib/wrangler-config.sh"

DEPLOY_ARGS=()
WRANGLER_CONFIG="$ROOT_DIR/backend/wrangler.toml"
WRANGLER_CONFIG_RUNTIME=""
SECRETS_FILE=""

is_truthy() {
  local raw="${1:-}"
  local normalized="${raw,,}"
  [[ "$normalized" == "1" || "$normalized" == "true" || "$normalized" == "yes" || "$normalized" == "on" ]]
}

resolve_optional_env_value() {
  local value
  if value="$(resolve_env_value_with_fallbacks "$@")"; then
    printf '%s' "$value"
    return 0
  fi
  printf ''
}

load_root_env "deploy-worker"

if [[ ! -f "$WRANGLER_CONFIG" ]]; then
  echo "[deploy-worker] Missing backend/wrangler.toml."
  echo "[deploy-worker] Create it from template:"
  echo "  cp backend/wrangler.toml.example backend/wrangler.toml"
  exit 1
fi

WRANGLER_CONFIG_RUNTIME="$(create_wrangler_runtime_config "$WRANGLER_CONFIG" "deploy-worker")"

cleanup() {
  if [[ -n "$SECRETS_FILE" ]]; then
    rm -f "$SECRETS_FILE"
  fi
  cleanup_wrangler_runtime_config "$WRANGLER_CONFIG_RUNTIME" "$WRANGLER_CONFIG"
}

trap cleanup EXIT

WORKER_ENV="${CF_WORKER_ENV:-}"
SYNC_SECRETS="${CF_WORKER_SYNC_SECRETS:-true}"
KEEP_VARS="${CF_WORKER_KEEP_VARS:-true}"
DRY_RUN="${CF_WORKER_DRY_RUN:-false}"
API_BASE_URL="$(resolve_optional_env_value "FRONTEND_VITE_API_BASE_URL" "VITE_API_BASE_URL")"

if [[ -n "$WORKER_ENV" ]]; then
  DEPLOY_ARGS+=(--env "$WORKER_ENV")
fi

if is_truthy "$KEEP_VARS"; then
  DEPLOY_ARGS+=(--keep-vars)
fi

if is_truthy "$DRY_RUN"; then
  DEPLOY_ARGS+=(--dry-run)
  if is_truthy "$SYNC_SECRETS"; then
    SYNC_SECRETS=false
    echo "[deploy-worker] Dry run mode: skipping worker secret sync."
  fi
  echo "[deploy-worker] Dry run mode enabled."
fi

if [[ -n "$API_BASE_URL" ]]; then
  echo "[deploy-worker] Building dashboard with VITE_API_BASE_URL=$API_BASE_URL"
else
  echo "[deploy-worker] Building dashboard with same-origin API base (empty VITE_API_BASE_URL)"
fi

echo "[deploy-worker] Backend typecheck..."
(
  cd "$ROOT_DIR/backend"
  npm run typecheck
)

(
  cd "$ROOT_DIR/dashboard"
  VITE_API_BASE_URL="$API_BASE_URL" npm run build
)

append_worker_var_arg() {
  local key="$1"
  shift
  local source_var_name

  if ! source_var_name="$(pick_first_set_var_name "$@")"; then
    return
  fi

  DEPLOY_ARGS+=(--var "${key}:${!source_var_name}")
  echo "[deploy-worker] Worker var $key from $source_var_name"
}

escape_dotenv_value() {
  local value="$1"

  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    return 1
  fi

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

append_worker_secret_file_entry() {
  local key="$1"
  shift
  local source_var_name
  local escaped_value

  if ! source_var_name="$(pick_first_set_var_name "$@")"; then
    return
  fi

  if ! escaped_value="$(escape_dotenv_value "${!source_var_name}")"; then
    echo "[deploy-worker] Secret $key from $source_var_name contains an unsupported newline." >&2
    exit 1
  fi

  if [[ -z "$SECRETS_FILE" ]]; then
    SECRETS_FILE="$(mktemp)"
    chmod 600 "$SECRETS_FILE"
  fi

  printf '%s="%s"\n' "$key" "$escaped_value" >>"$SECRETS_FILE"
  echo "[deploy-worker] Worker secret $key from $source_var_name"
}

require_worker_secret_file_entry() {
  local key="$1"
  shift
  local source_var_name

  if ! source_var_name="$(pick_first_set_var_name "$@")"; then
    echo "[deploy-worker] Missing required worker secret source for $key." >&2
    exit 1
  fi

  if [[ -z "${!source_var_name}" ]]; then
    echo "[deploy-worker] Required worker secret $key from $source_var_name is empty." >&2
    exit 1
  fi

  append_worker_secret_file_entry "$key" "$source_var_name"
}

append_worker_var_arg "MQTT_CLIENT_ID_PREFIX" "BACKEND_MQTT_CLIENT_ID_PREFIX"
append_worker_var_arg "JWT_ACCESS_TTL_SEC" "BACKEND_JWT_ACCESS_TTL_SEC"
append_worker_var_arg "JWT_REFRESH_TTL_SEC" "BACKEND_JWT_REFRESH_TTL_SEC"
append_worker_var_arg "COOKIE_SECURE" "BACKEND_COOKIE_SECURE"
append_worker_var_arg "COOKIE_SAME_SITE" "BACKEND_COOKIE_SAME_SITE"
append_worker_var_arg "COOKIE_DOMAIN" "BACKEND_COOKIE_DOMAIN"
append_worker_var_arg "CORS_ORIGINS" "BACKEND_CORS_ORIGINS"
append_worker_var_arg "AUTH_LOGIN_RATE_LIMIT_MAX" "BACKEND_AUTH_LOGIN_RATE_LIMIT_MAX"
append_worker_var_arg "AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC" "BACKEND_AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC"
append_worker_var_arg "COMMAND_EXECUTE_RATE_LIMIT_MAX" "BACKEND_COMMAND_EXECUTE_RATE_LIMIT_MAX"
append_worker_var_arg "COMMAND_EXECUTE_RATE_LIMIT_WINDOW_SEC" "BACKEND_COMMAND_EXECUTE_RATE_LIMIT_WINDOW_SEC"
append_worker_var_arg "SEED_ADMIN_EMAIL" "BACKEND_SEED_ADMIN_EMAIL"
append_worker_var_arg "SEED_SAMPLE_DEVICE_ID" "BACKEND_SEED_SAMPLE_DEVICE_ID"

if is_truthy "$SYNC_SECRETS"; then
  if is_truthy "$DRY_RUN"; then
    echo "[deploy-worker] Dry run mode: skipping worker secrets file."
  else
    require_worker_secret_file_entry "JWT_SECRET" "BACKEND_JWT_SECRET"
    require_worker_secret_file_entry "MQTT_WS_URL" "BACKEND_MQTT_WS_URL"
    append_worker_secret_file_entry "MQTT_USERNAME" "BACKEND_MQTT_USERNAME"
    append_worker_secret_file_entry "MQTT_PASSWORD" "BACKEND_MQTT_PASSWORD"
    append_worker_secret_file_entry "SEED_ADMIN_PASSWORD" "BACKEND_SEED_ADMIN_PASSWORD"

    if [[ -n "$SECRETS_FILE" ]]; then
      DEPLOY_ARGS+=(--secrets-file "$SECRETS_FILE")
    fi
  fi
fi

echo "[deploy-worker] Deploying Cloudflare Worker..."
(
  cd "$ROOT_DIR/backend"
  npx wrangler -c "$WRANGLER_CONFIG_RUNTIME" deploy "${DEPLOY_ARGS[@]}"
)

echo "[deploy-worker] Done."

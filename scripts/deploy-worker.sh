#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"

DEPLOY_ARGS=()
SECRET_ARGS=()

is_truthy() {
  local raw="${1:-}"
  local normalized="${raw,,}"
  [[ "$normalized" == "1" || "$normalized" == "true" || "$normalized" == "yes" || "$normalized" == "on" ]]
}

load_root_env "deploy-worker" || true

WORKER_ENV="${CF_WORKER_ENV:-}"
SYNC_SECRETS="${CF_WORKER_SYNC_SECRETS:-true}"
KEEP_VARS="${CF_WORKER_KEEP_VARS:-true}"
DRY_RUN="${CF_WORKER_DRY_RUN:-false}"

if [[ -n "$WORKER_ENV" ]]; then
  DEPLOY_ARGS+=(--env "$WORKER_ENV")
  SECRET_ARGS+=(--env "$WORKER_ENV")
fi

if is_truthy "$KEEP_VARS"; then
  DEPLOY_ARGS+=(--keep-vars)
fi

if is_truthy "$DRY_RUN"; then
  DEPLOY_ARGS+=(--dry-run)
  echo "[deploy-worker] Dry run mode enabled."
fi

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

sync_worker_secret() {
  local key="$1"
  shift
  local source_var_name

  if ! source_var_name="$(pick_first_set_var_name "$@")"; then
    return
  fi

  echo "[deploy-worker] Sync worker secret $key from $source_var_name"
  (
    cd "$ROOT_DIR/backend"
    printf '%s' "${!source_var_name}" | npx wrangler secret put "$key" "${SECRET_ARGS[@]}"
  )
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
append_worker_var_arg "COMMAND_SIGN_RATE_LIMIT_MAX" "BACKEND_COMMAND_SIGN_RATE_LIMIT_MAX"
append_worker_var_arg "COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC" "BACKEND_COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC"
append_worker_var_arg "SEED_ADMIN_EMAIL" "BACKEND_SEED_ADMIN_EMAIL"
append_worker_var_arg "SEED_SAMPLE_DEVICE_ID" "BACKEND_SEED_SAMPLE_DEVICE_ID"

if is_truthy "$SYNC_SECRETS"; then
  sync_worker_secret "JWT_SECRET" "BACKEND_JWT_SECRET"
  sync_worker_secret "HMAC_GLOBAL_FALLBACK_SECRET" "BACKEND_HMAC_GLOBAL_FALLBACK_SECRET"
  sync_worker_secret "MQTT_WS_URL" "BACKEND_MQTT_WS_URL"
  sync_worker_secret "MQTT_USERNAME" "BACKEND_MQTT_USERNAME"
  sync_worker_secret "MQTT_PASSWORD" "BACKEND_MQTT_PASSWORD"
  sync_worker_secret "SEED_ADMIN_PASSWORD" "BACKEND_SEED_ADMIN_PASSWORD"
fi

echo "[deploy-worker] Deploying Cloudflare Worker..."
(
  cd "$ROOT_DIR/backend"
  npx wrangler deploy "${DEPLOY_ARGS[@]}"
)

echo "[deploy-worker] Done."

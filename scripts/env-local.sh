#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="$ROOT_DIR/backend/.dev.vars"
FRONTEND_ENV_FILE="$ROOT_DIR/dashboard/.env.local"
ROOT_OVERRIDE_FILE="$ROOT_DIR/.env"

copy_if_missing() {
  local src="$1"
  local dst="$2"

  if [[ -f "$dst" ]]; then
    echo "[env-local] Skip (already exists): $dst"
    return
  fi

  cp "$src" "$dst"
  echo "[env-local] Created: $dst"
}

upsert_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file="$(mktemp)"
  if [[ -f "$file" ]]; then
    grep -v "^${key}=" "$file" >"$tmp_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >>"$tmp_file"
  mv "$tmp_file" "$file"
}

apply_override_if_set() {
  local file="$1"
  local target_key="$2"
  local source_var_name="$3"

  if [[ "${!source_var_name+x}" != "x" ]]; then
    return
  fi

  upsert_env_line "$file" "$target_key" "${!source_var_name}"
  echo "[env-local] Override $target_key from $source_var_name"
}

copy_if_missing "$ROOT_DIR/backend/.dev.vars.local.example" "$BACKEND_ENV_FILE"
copy_if_missing "$ROOT_DIR/dashboard/.env.example" "$FRONTEND_ENV_FILE"

if [[ -f "$ROOT_OVERRIDE_FILE" ]]; then
  echo "[env-local] Loading root overrides from $ROOT_OVERRIDE_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_OVERRIDE_FILE"
  set +a

  # Backend overrides
  apply_override_if_set "$BACKEND_ENV_FILE" "JWT_SECRET" "BACKEND_JWT_SECRET"
  apply_override_if_set "$BACKEND_ENV_FILE" "HMAC_GLOBAL_FALLBACK_SECRET" "BACKEND_HMAC_GLOBAL_FALLBACK_SECRET"
  apply_override_if_set "$BACKEND_ENV_FILE" "MQTT_WS_URL" "BACKEND_MQTT_WS_URL"
  apply_override_if_set "$BACKEND_ENV_FILE" "MQTT_USERNAME" "BACKEND_MQTT_USERNAME"
  apply_override_if_set "$BACKEND_ENV_FILE" "MQTT_PASSWORD" "BACKEND_MQTT_PASSWORD"
  apply_override_if_set "$BACKEND_ENV_FILE" "MQTT_CLIENT_ID_PREFIX" "BACKEND_MQTT_CLIENT_ID_PREFIX"
  apply_override_if_set "$BACKEND_ENV_FILE" "JWT_ACCESS_TTL_SEC" "BACKEND_JWT_ACCESS_TTL_SEC"
  apply_override_if_set "$BACKEND_ENV_FILE" "JWT_REFRESH_TTL_SEC" "BACKEND_JWT_REFRESH_TTL_SEC"
  apply_override_if_set "$BACKEND_ENV_FILE" "COOKIE_SECURE" "BACKEND_COOKIE_SECURE"
  apply_override_if_set "$BACKEND_ENV_FILE" "COOKIE_SAME_SITE" "BACKEND_COOKIE_SAME_SITE"
  apply_override_if_set "$BACKEND_ENV_FILE" "COOKIE_DOMAIN" "BACKEND_COOKIE_DOMAIN"
  apply_override_if_set "$BACKEND_ENV_FILE" "CORS_ORIGINS" "BACKEND_CORS_ORIGINS"
  apply_override_if_set "$BACKEND_ENV_FILE" "AUTH_LOGIN_RATE_LIMIT_MAX" "BACKEND_AUTH_LOGIN_RATE_LIMIT_MAX"
  apply_override_if_set "$BACKEND_ENV_FILE" "AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC" "BACKEND_AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC"
  apply_override_if_set "$BACKEND_ENV_FILE" "COMMAND_SIGN_RATE_LIMIT_MAX" "BACKEND_COMMAND_SIGN_RATE_LIMIT_MAX"
  apply_override_if_set "$BACKEND_ENV_FILE" "COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC" "BACKEND_COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC"
  apply_override_if_set "$BACKEND_ENV_FILE" "SEED_ADMIN_EMAIL" "BACKEND_SEED_ADMIN_EMAIL"
  apply_override_if_set "$BACKEND_ENV_FILE" "SEED_ADMIN_PASSWORD" "BACKEND_SEED_ADMIN_PASSWORD"
  apply_override_if_set "$BACKEND_ENV_FILE" "SEED_SAMPLE_DEVICE_ID" "BACKEND_SEED_SAMPLE_DEVICE_ID"

  # Frontend overrides
  apply_override_if_set "$FRONTEND_ENV_FILE" "VITE_API_BASE_URL" "FRONTEND_VITE_API_BASE_URL"
  apply_override_if_set "$FRONTEND_ENV_FILE" "VITE_MQTT_WS_URL" "FRONTEND_VITE_MQTT_WS_URL"
  apply_override_if_set "$FRONTEND_ENV_FILE" "VITE_MQTT_USERNAME" "FRONTEND_VITE_MQTT_USERNAME"
  apply_override_if_set "$FRONTEND_ENV_FILE" "VITE_MQTT_PASSWORD" "FRONTEND_VITE_MQTT_PASSWORD"
  apply_override_if_set "$FRONTEND_ENV_FILE" "VITE_MQTT_CLIENT_ID_PREFIX" "FRONTEND_VITE_MQTT_CLIENT_ID_PREFIX"
else
  echo "[env-local] Root override file not found: $ROOT_OVERRIDE_FILE"
fi

echo "[env-local] Done."

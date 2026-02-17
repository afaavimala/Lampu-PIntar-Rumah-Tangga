#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"

if [[ -f "$ROOT_DIR/.env" ]]; then
  echo "[dev] Syncing local env files from root .env ..."
  bash "$ROOT_DIR/scripts/env-local.sh"
fi

resolve_optional_env_value() {
  local value
  if value="$(resolve_env_value_with_fallbacks "$@")"; then
    printf '%s' "$value"
    return 0
  fi
  printf ''
}

load_root_env "dev" || true

BACKEND_PORT="$(resolve_optional_env_value "BACKEND_PORT")"
if [[ -z "$BACKEND_PORT" ]]; then
  BACKEND_PORT=8787
fi

API_BASE_URL="$(resolve_optional_env_value "FRONTEND_VITE_API_BASE_URL" "VITE_API_BASE_URL")"
if [[ -z "$API_BASE_URL" ]]; then
  API_BASE_URL="http://127.0.0.1:${BACKEND_PORT}"
fi

BACKEND_PID=""
DASHBOARD_PID=""

cleanup() {
  if [[ -n "$DASHBOARD_PID" ]] && kill -0 "$DASHBOARD_PID" 2>/dev/null; then
    kill "$DASHBOARD_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[dev] Starting backend on :$BACKEND_PORT ..."
(
  cd "$ROOT_DIR/backend"
  PORT="$BACKEND_PORT" npm run dev
) &
BACKEND_PID="$!"

echo "[dev] Starting dashboard on :5173 ..."
(
  cd "$ROOT_DIR/dashboard"
  VITE_API_BASE_URL="$API_BASE_URL" npm run dev -- --host 127.0.0.1 --port 5173
) &
DASHBOARD_PID="$!"

wait -n "$BACKEND_PID" "$DASHBOARD_PID"

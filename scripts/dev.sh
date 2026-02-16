#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:8787}"
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

echo "[dev] Starting backend on :8787 ..."
(
  cd "$ROOT_DIR/backend"
  npm run dev
) &
BACKEND_PID="$!"

echo "[dev] Starting dashboard on :5173 ..."
(
  cd "$ROOT_DIR/dashboard"
  VITE_API_BASE_URL="$API_BASE_URL" npm run dev -- --host 127.0.0.1 --port 5173
) &
DASHBOARD_PID="$!"

wait -n "$BACKEND_PID" "$DASHBOARD_PID"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_PROJECT="${CF_PAGES_PROJECT:-smartlamp-dashboard}"
API_BASE_URL="${VITE_API_BASE_URL:-}"
MQTT_WS_URL="${VITE_MQTT_WS_URL:-}"
MQTT_USERNAME="${VITE_MQTT_USERNAME:-}"
MQTT_PASSWORD="${VITE_MQTT_PASSWORD:-}"
MQTT_CLIENT_ID_PREFIX="${VITE_MQTT_CLIENT_ID_PREFIX:-}"

if [[ -n "$API_BASE_URL" ]]; then
  echo "[deploy-pages] Using VITE_API_BASE_URL=$API_BASE_URL"
else
  echo "[deploy-pages] WARNING: VITE_API_BASE_URL is not set. Build may use local/default API URL."
fi

echo "[deploy-pages] Building dashboard..."
(
  cd "$ROOT_DIR/dashboard"
  VITE_API_BASE_URL="$API_BASE_URL" \
  VITE_MQTT_WS_URL="$MQTT_WS_URL" \
  VITE_MQTT_USERNAME="$MQTT_USERNAME" \
  VITE_MQTT_PASSWORD="$MQTT_PASSWORD" \
  VITE_MQTT_CLIENT_ID_PREFIX="$MQTT_CLIENT_ID_PREFIX" \
  npm run build
)

echo "[deploy-pages] Deploying dashboard to Cloudflare Pages project: $PAGES_PROJECT"
(
  cd "$ROOT_DIR/backend"
  npx wrangler pages deploy "$ROOT_DIR/dashboard/dist" --project-name "$PAGES_PROJECT"
)

echo "[deploy-pages] Done."

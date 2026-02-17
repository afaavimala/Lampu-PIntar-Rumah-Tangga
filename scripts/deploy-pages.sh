#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"

resolve_optional_env_value() {
  local value
  if value="$(resolve_env_value_with_fallbacks "$@")"; then
    printf '%s' "$value"
    return 0
  fi
  printf ''
}

load_root_env "deploy-pages" || true

echo "[deploy-pages] Legacy flow: deploy frontend ke Cloudflare Pages terpisah."

PAGES_PROJECT="$(resolve_optional_env_value "CF_PAGES_PROJECT")"
if [[ -z "$PAGES_PROJECT" ]]; then
  PAGES_PROJECT="smartlamp-dashboard"
fi

PAGES_BRANCH="$(resolve_optional_env_value "CF_PAGES_BRANCH")"

API_BASE_URL="$(resolve_optional_env_value "FRONTEND_VITE_API_BASE_URL" "VITE_API_BASE_URL")"
PAGES_ARGS=(--project-name "$PAGES_PROJECT")

if [[ -n "$API_BASE_URL" ]]; then
  echo "[deploy-pages] Using VITE_API_BASE_URL=$API_BASE_URL"
else
  echo "[deploy-pages] WARNING: VITE_API_BASE_URL is not set. Build may use local/default API URL."
fi

if [[ -n "$PAGES_BRANCH" ]]; then
  PAGES_ARGS+=(--branch "$PAGES_BRANCH")
  echo "[deploy-pages] Using Pages branch: $PAGES_BRANCH"
fi

echo "[deploy-pages] Building dashboard..."
(
  cd "$ROOT_DIR/dashboard"
  VITE_API_BASE_URL="$API_BASE_URL" npm run build
)

echo "[deploy-pages] Deploying dashboard to Cloudflare Pages project: $PAGES_PROJECT"
(
  cd "$ROOT_DIR/backend"
  npx wrangler pages deploy "$ROOT_DIR/dashboard/dist" "${PAGES_ARGS[@]}"
)

echo "[deploy-pages] Done."

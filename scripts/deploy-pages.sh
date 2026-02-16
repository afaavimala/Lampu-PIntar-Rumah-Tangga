#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_PROJECT="${CF_PAGES_PROJECT:-smartlamp-dashboard}"

echo "[deploy-pages] Building dashboard..."
(
  cd "$ROOT_DIR/dashboard"
  npm run build
)

echo "[deploy-pages] Deploying dashboard to Cloudflare Pages project: $PAGES_PROJECT"
(
  cd "$ROOT_DIR/backend"
  npx wrangler pages deploy "$ROOT_DIR/dashboard/dist" --project-name "$PAGES_PROJECT"
)

echo "[deploy-pages] Done."

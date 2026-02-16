#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[deploy-worker] Deploying Cloudflare Worker..."
(
  cd "$ROOT_DIR/backend"
  npm run deploy
)

echo "[deploy-worker] Done."

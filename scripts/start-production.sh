#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/backend/.env.production" ]]; then
  echo "[start-production] Missing backend/.env.production. Run: npm run env:production"
  exit 1
fi

echo "[start-production] Starting backend (single port production)..."
(
  cd "$ROOT_DIR/backend"
  npm run start
)

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/backend/.env.production" ]]; then
  echo "[migrate-production] Missing backend/.env.production. Run: npm run env:production"
  exit 1
fi

echo "[migrate-production] Applying production MariaDB migrations..."
(
  cd "$ROOT_DIR/backend"
  npm run migrate:production
)

echo "[migrate-production] Done."

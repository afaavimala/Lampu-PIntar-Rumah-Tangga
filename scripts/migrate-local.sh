#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/backend/.env.local" ]]; then
  echo "[migrate-local] Missing backend/.env.local. Run: npm run env:local"
  exit 1
fi

echo "[migrate-local] Applying local MariaDB migrations..."
(
  cd "$ROOT_DIR/backend"
  npm run migrate
)

echo "[migrate-local] Done."

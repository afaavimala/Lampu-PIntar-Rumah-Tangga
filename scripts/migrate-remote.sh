#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[migrate-remote] Applying remote D1 migrations..."
(
  cd "$ROOT_DIR/backend"
  npx wrangler d1 migrations apply smartlamp_db --remote
)

echo "[migrate-remote] Done."

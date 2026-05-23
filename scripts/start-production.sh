#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/port-guard.sh"

echo "[start-production] Syncing production env from root .env ..."
bash "$ROOT_DIR/scripts/env-production.sh"

if [[ ! -f "$ROOT_DIR/backend/.env.production" ]]; then
  echo "[start-production] Missing backend/.env.production. Run: npm run env:production"
  exit 1
fi

PORT_VALUE="$(read_env_value "$ROOT_DIR/backend/.env.production" "PORT" "8787")"
assert_port_available "$PORT_VALUE" "start-production"

echo "[start-production] Starting backend (single port production)..."
cd "$ROOT_DIR/backend"
exec npm run start

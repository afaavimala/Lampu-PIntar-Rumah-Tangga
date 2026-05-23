#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/port-guard.sh"

echo "[deploy-local] Start local deployment flow (build + migrate + run)..."
bash "$ROOT_DIR/scripts/env-production.sh"

PORT_VALUE="$(read_env_value "$ROOT_DIR/backend/.env.production" "PORT" "8787")"
assert_port_available "$PORT_VALUE" "deploy-local"

bash "$ROOT_DIR/scripts/migrate-production.sh"
bash "$ROOT_DIR/scripts/build-all.sh"
exec bash "$ROOT_DIR/scripts/start-production.sh"

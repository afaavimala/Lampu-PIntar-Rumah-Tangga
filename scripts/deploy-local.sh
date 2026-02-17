#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[deploy-local] Start local deployment flow (build + migrate + run)..."
bash "$ROOT_DIR/scripts/env-production.sh"
bash "$ROOT_DIR/scripts/migrate-production.sh"
bash "$ROOT_DIR/scripts/build-all.sh"
bash "$ROOT_DIR/scripts/start-production.sh"

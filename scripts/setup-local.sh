#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[setup-local] Start local setup..."
bash "$ROOT_DIR/scripts/install-all.sh"
bash "$ROOT_DIR/scripts/env-local.sh"
bash "$ROOT_DIR/scripts/migrate-local.sh"
echo "[setup-local] Done."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[setup-production] Start production setup..."
bash "$ROOT_DIR/scripts/install-all.sh"
bash "$ROOT_DIR/scripts/env-production.sh"
bash "$ROOT_DIR/scripts/migrate-production.sh"
echo "[setup-production] Done."

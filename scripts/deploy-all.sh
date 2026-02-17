#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[deploy] Start cloud deploy (single Worker: API + dashboard assets)..."
bash "$ROOT_DIR/scripts/deploy-worker.sh"
echo "[deploy] Done."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[deploy] Start full deploy (worker + pages)..."
bash "$ROOT_DIR/scripts/deploy-worker.sh"
bash "$ROOT_DIR/scripts/deploy-pages.sh"
echo "[deploy] Done."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[install-all] Installing backend dependencies..."
(
  cd "$ROOT_DIR/backend"
  npm install
)

echo "[install-all] Installing dashboard dependencies..."
(
  cd "$ROOT_DIR/dashboard"
  npm install
)

echo "[install-all] Done."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[build-all] Backend typecheck..."
(
  cd "$ROOT_DIR/backend"
  npm run typecheck
)

echo "[build-all] Backend test..."
(
  cd "$ROOT_DIR/backend"
  npm run test
)

echo "[build-all] Dashboard build..."
(
  cd "$ROOT_DIR/dashboard"
  npm run build
)

echo "[build-all] Done."

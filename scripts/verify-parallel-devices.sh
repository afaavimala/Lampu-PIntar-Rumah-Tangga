#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"

load_root_env "verify-parallel" || true

BACKEND_PORT="${BACKEND_PORT:-8787}"
BASE_URL="${VERIFY_BASE_URL:-http://127.0.0.1:${BACKEND_PORT}}"
COUNT="${VERIFY_PARALLEL_COUNT:-10}"

if [[ "$COUNT" -lt 1 ]]; then
  echo "[verify-parallel] VERIFY_PARALLEL_COUNT must be >= 1"
  exit 1
fi

if [[ -z "${BACKEND_SEED_ADMIN_EMAIL:-}" || -z "${BACKEND_SEED_ADMIN_PASSWORD:-}" ]]; then
  echo "[verify-parallel] Missing BACKEND_SEED_ADMIN_EMAIL or BACKEND_SEED_ADMIN_PASSWORD in environment"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
COOKIE_FILE="$TMP_DIR/cookies.txt"
DEVICE_FILE="$TMP_DIR/devices.txt"
RESULT_FILE="$TMP_DIR/results.txt"
export BASE_URL COOKIE_FILE RESULT_FILE

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[verify-parallel] Base URL: $BASE_URL"
echo "[verify-parallel] Device count: $COUNT"

LOGIN_BODY="$(printf '{"email":"%s","password":"%s"}' "$BACKEND_SEED_ADMIN_EMAIL" "$BACKEND_SEED_ADMIN_PASSWORD")"
LOGIN_RESPONSE="$(curl -sS -c "$COOKIE_FILE" -H "content-type: application/json" -d "$LOGIN_BODY" "$BASE_URL/api/v1/auth/login")"
if [[ "$LOGIN_RESPONSE" != *'"success":true'* ]]; then
  echo "[verify-parallel] Login failed: $LOGIN_RESPONSE"
  exit 1
fi

echo "[verify-parallel] Login OK"

for i in $(seq 1 "$COUNT"); do
  device_id="parallel-$(date +%s)-$i"
  create_body="$(printf '{"deviceId":"%s","name":"Parallel Device %s","location":"Parallel Lab"}' "$device_id" "$i")"
  create_resp="$(curl -sS -b "$COOKIE_FILE" -H "content-type: application/json" -H "idempotency-key: create-$device_id" -d "$create_body" "$BASE_URL/api/v1/devices")"
  if [[ "$create_resp" != *'"success":true'* && "$create_resp" != *'Device ID already exists'* ]]; then
    echo "[verify-parallel] Failed create device $device_id: $create_resp"
    exit 1
  fi
  echo "$device_id" >>"$DEVICE_FILE"
done

echo "[verify-parallel] Device creation OK"

execute_one() {
  local device_id="$1"
  local request_id="parallel-req-${device_id}-$(date +%s%N)"
  local idem="parallel-idem-${device_id}-$(date +%s%N)"
  local body
  local resp

  body="$(printf '{"deviceId":"%s","action":"ON","requestId":"%s"}' "$device_id" "$request_id")"
  resp="$(curl -sS -b "$COOKIE_FILE" -H "content-type: application/json" -H "idempotency-key: $idem" -d "$body" "$BASE_URL/api/v1/commands/execute")"

  if [[ "$resp" == *'"success":true'* ]]; then
    printf 'OK %s\n' "$device_id" >>"$RESULT_FILE"
    return 0
  fi

  printf 'FAIL %s %s\n' "$device_id" "$resp" >>"$RESULT_FILE"
  return 1
}

export -f execute_one

if ! xargs -P "$COUNT" -I{} bash -lc 'execute_one "$@"' _ {} <"$DEVICE_FILE"; then
  true
fi

ok_count="$(grep -c '^OK ' "$RESULT_FILE" || true)"
fail_count="$(grep -c '^FAIL ' "$RESULT_FILE" || true)"

echo "[verify-parallel] OK: $ok_count"
echo "[verify-parallel] FAIL: $fail_count"

if [[ "$ok_count" -ne "$COUNT" ]]; then
  echo "[verify-parallel] Parallel verification failed."
  cat "$RESULT_FILE"
  exit 1
fi

echo "[verify-parallel] Parallel verification passed."

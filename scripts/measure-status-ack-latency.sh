#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"

load_root_env "measure-latency" || true

BACKEND_PORT="${BACKEND_PORT:-8787}"
BASE_URL="${VERIFY_BASE_URL:-http://127.0.0.1:${BACKEND_PORT}}"
DEVICE_ID="${VERIFY_DEVICE_ID:-${BACKEND_SEED_SAMPLE_DEVICE_ID:-lampu-ruang-tamu}}"

if [[ -z "${BACKEND_SEED_ADMIN_EMAIL:-}" || -z "${BACKEND_SEED_ADMIN_PASSWORD:-}" ]]; then
  echo "[measure-latency] Missing BACKEND_SEED_ADMIN_EMAIL or BACKEND_SEED_ADMIN_PASSWORD in environment"
  exit 1
fi

if [[ -z "${BACKEND_MQTT_WS_URL:-}" || -z "${BACKEND_MQTT_USERNAME:-}" || -z "${BACKEND_MQTT_PASSWORD:-}" ]]; then
  echo "[measure-latency] Missing MQTT configuration in environment"
  exit 1
fi

MQTT_HOST="${BACKEND_MQTT_WS_URL#wss://}"
MQTT_HOST="${MQTT_HOST#ws://}"
MQTT_HOST="${MQTT_HOST%%/*}"
MQTT_HOST="${MQTT_HOST%%:*}"

CMD_TOPIC="home/${DEVICE_ID}/cmd"
STATUS_TOPIC="home/${DEVICE_ID}/status"

TMP_DIR="$(mktemp -d)"
COOKIE_FILE="$TMP_DIR/cookies.txt"
CMD_FILE="$TMP_DIR/cmd.json"
STATUS_FILE="$TMP_DIR/status.json"
STATUS_TS_FILE="$TMP_DIR/status.ts"
CMD_PID_FILE="$TMP_DIR/cmd.pid"
STATUS_PID_FILE="$TMP_DIR/status.pid"

cleanup() {
  if [[ -f "$CMD_PID_FILE" ]]; then
    pid="$(cat "$CMD_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  fi
  if [[ -f "$STATUS_PID_FILE" ]]; then
    pid="$(cat "$STATUS_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[measure-latency] Base URL: $BASE_URL"
echo "[measure-latency] Device ID: $DEVICE_ID"
echo "[measure-latency] CMD topic: $CMD_TOPIC"
echo "[measure-latency] STATUS topic: $STATUS_TOPIC"

LOGIN_BODY="$(printf '{"email":"%s","password":"%s"}' "$BACKEND_SEED_ADMIN_EMAIL" "$BACKEND_SEED_ADMIN_PASSWORD")"
LOGIN_RESPONSE="$(curl -sS -c "$COOKIE_FILE" -H "content-type: application/json" -d "$LOGIN_BODY" "$BASE_URL/api/v1/auth/login")"
if [[ "$LOGIN_RESPONSE" != *'"success":true'* ]]; then
  echo "[measure-latency] Login failed: $LOGIN_RESPONSE"
  exit 1
fi

(
  set -euo pipefail
  msg="$(mosquitto_sub -h "$MQTT_HOST" -p 8883 -u "$BACKEND_MQTT_USERNAME" -P "$BACKEND_MQTT_PASSWORD" -t "$CMD_TOPIC" -C 1 -W 30)"
  printf '%s' "$msg" >"$CMD_FILE"
  request_id="$(printf '%s' "$msg" | sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p')"
  if [[ -z "$request_id" ]]; then
    request_id="unknown-request-id"
  fi
  ack_ts="$(date +%s%3N)"
  ack_payload="$(printf '{"deviceId":"%s","power":"ON","ts":%s,"requestId":"%s","source":"latency-sim"}' "$DEVICE_ID" "$ack_ts" "$request_id")"
  mosquitto_pub -h "$MQTT_HOST" -p 8883 -u "$BACKEND_MQTT_USERNAME" -P "$BACKEND_MQTT_PASSWORD" -t "$STATUS_TOPIC" -m "$ack_payload" -r
) &
echo "$!" >"$CMD_PID_FILE"

(
  set -euo pipefail
  msg="$(mosquitto_sub -h "$MQTT_HOST" -p 8883 -u "$BACKEND_MQTT_USERNAME" -P "$BACKEND_MQTT_PASSWORD" -t "$STATUS_TOPIC" -C 1 -W 30)"
  printf '%s' "$msg" >"$STATUS_FILE"
  date +%s%3N >"$STATUS_TS_FILE"
) &
echo "$!" >"$STATUS_PID_FILE"

sleep 1

request_id="latency-req-$(date +%s%N)"
idempotency_key="latency-idem-$(date +%s%N)"
body="$(printf '{"deviceId":"%s","action":"ON","requestId":"%s"}' "$DEVICE_ID" "$request_id")"

t0="$(date +%s%3N)"
response="$(curl -sS -b "$COOKIE_FILE" -H "content-type: application/json" -H "idempotency-key: $idempotency_key" -d "$body" "$BASE_URL/api/v1/commands/execute")"
t1="$(date +%s%3N)"

if [[ "$response" != *'"success":true'* ]]; then
  echo "[measure-latency] Execute command failed: $response"
  exit 1
fi

cmd_pid="$(cat "$CMD_PID_FILE")"
status_pid="$(cat "$STATUS_PID_FILE")"
wait "$cmd_pid"
wait "$status_pid"

status_ts="$(cat "$STATUS_TS_FILE")"

api_latency_ms=$((t1 - t0))
ack_latency_ms=$((status_ts - t0))

echo "[measure-latency] API execute latency: ${api_latency_ms} ms"
echo "[measure-latency] End-to-end (request -> status ack observed): ${ack_latency_ms} ms"
echo "[measure-latency] Command payload:"
cat "$CMD_FILE"
echo
echo "[measure-latency] Status payload:"
cat "$STATUS_FILE"
echo

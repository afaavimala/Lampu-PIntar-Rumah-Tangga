#!/usr/bin/env bash
set -euo pipefail

read_env_value() {
  local file="$1"
  local key="$2"
  local fallback="${3:-}"

  if [[ ! -f "$file" ]]; then
    printf '%s' "$fallback"
    return 0
  fi

  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$fallback"
    return 0
  fi

  printf '%s' "${line#*=}"
}

print_port_listener_details() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :$port )" || true
    return 0
  fi

  echo "[port-guard] No port inspection tool available (expected lsof or ss)."
}

assert_port_available() {
  local port="$1"
  local context="${2:-process}"

  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[$context] Port $port is already in use."
      echo "[$context] Stop the existing listener first, then rerun the command."
      print_port_listener_details "$port"
      return 1
    fi
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :$port )" | tail -n +2 | grep -q .; then
      echo "[$context] Port $port is already in use."
      echo "[$context] Stop the existing listener first, then rerun the command."
      print_port_listener_details "$port"
      return 1
    fi
  fi
}

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_OVERRIDE_FILE="${ROOT_OVERRIDE_FILE:-$ROOT_DIR/.env}"

is_truthy() {
  local raw="${1:-}"
  local normalized="${raw,,}"
  [[ "$normalized" == "1" || "$normalized" == "true" || "$normalized" == "yes" || "$normalized" == "on" ]]
}

copy_if_missing() {
  local src="$1"
  local dst="$2"
  local tag="${3:-env}"

  if [[ -f "$dst" ]]; then
    echo "[$tag] Skip (already exists): $dst"
    return
  fi

  cp "$src" "$dst"
  echo "[$tag] Created: $dst"
}

upsert_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file="$(mktemp)"
  if [[ -f "$file" ]]; then
    grep -v "^${key}=" "$file" >"$tmp_file" || true
  fi
  printf '%s=%s\n' "$key" "$value" >>"$tmp_file"
  mv "$tmp_file" "$file"
}

validate_root_env_file() {
  local tag="${1:-env}"
  local line
  local key
  local line_no=0
  local failed=false
  declare -A seen_lines=()

  if [[ ! -f "$ROOT_OVERRIDE_FILE" ]]; then
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    line="${line%$'\r'}"

    if [[ -z "${line//[[:space:]]/}" ]]; then
      continue
    fi

    if [[ "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    if [[ "$line" != *"="* ]]; then
      echo "[$tag] Invalid env line at $ROOT_OVERRIDE_FILE:$line_no (missing '=')" >&2
      failed=true
      continue
    fi

    key="${line%%=*}"
    key="$(printf '%s' "$key" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "[$tag] Invalid env key at $ROOT_OVERRIDE_FILE:$line_no: $key" >&2
      failed=true
      continue
    fi

    if [[ -n "${seen_lines[$key]:-}" ]]; then
      echo "[$tag] Duplicate env key $key at $ROOT_OVERRIDE_FILE:${seen_lines[$key]} and $line_no" >&2
      failed=true
      continue
    fi

    seen_lines[$key]="$line_no"
  done <"$ROOT_OVERRIDE_FILE"

  if [[ "$failed" == "true" ]]; then
    return 1
  fi
}

load_root_env() {
  local tag="${1:-env}"
  local line
  local key
  local value
  local overwrite_existing="${ROOT_ENV_OVERWRITE_EXISTING:-false}"

  if [[ ! -f "$ROOT_OVERRIDE_FILE" ]]; then
    echo "[$tag] Root override file not found: $ROOT_OVERRIDE_FILE"
    return 1
  fi

  if ! validate_root_env_file "$tag"; then
    return 1
  fi

  echo "[$tag] Loading root overrides from $ROOT_OVERRIDE_FILE"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"

    if [[ -z "${line//[[:space:]]/}" ]]; then
      continue
    fi

    if [[ "$line" =~ ^[[:space:]]*# ]]; then
      continue
    fi

    if [[ "$line" != *"="* ]]; then
      return 1
    fi

    key="${line%%=*}"
    value="${line#*=}"

    key="$(printf '%s' "$key" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//')"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      return 1
    fi

    if [[ "${!key+x}" == "x" ]] && ! is_truthy "$overwrite_existing"; then
      echo "[$tag] Keep existing $key from process environment"
      continue
    fi

    if [[ "$value" =~ ^\"(.*)\"$ ]]; then
      value="${BASH_REMATCH[1]}"
    elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    printf -v "$key" '%s' "$value"
    export "$key"
  done <"$ROOT_OVERRIDE_FILE"
}

pick_first_set_var_name() {
  local source_var_name

  for source_var_name in "$@"; do
    if [[ -z "$source_var_name" ]]; then
      continue
    fi

    if [[ "${!source_var_name+x}" == "x" ]]; then
      printf '%s\n' "$source_var_name"
      return 0
    fi
  done

  return 1
}

apply_override_with_fallbacks() {
  local tag="$1"
  local file="$2"
  local target_key="$3"
  shift 3
  local source_var_name

  if ! source_var_name="$(pick_first_set_var_name "$@")"; then
    return
  fi

  upsert_env_line "$file" "$target_key" "${!source_var_name}"
  echo "[$tag] Override $target_key from $source_var_name"
}

resolve_env_value_with_fallbacks() {
  local source_var_name

  if ! source_var_name="$(pick_first_set_var_name "$@")"; then
    return 1
  fi

  printf '%s' "${!source_var_name}"
}

apply_env_mappings() {
  local tag="$1"
  local file="$2"
  shift 2
  local mapping
  local target_key
  local source_var_name

  for mapping in "$@"; do
    target_key="${mapping%%:*}"
    source_var_name="${mapping#*:}"
    apply_override_with_fallbacks "$tag" "$file" "$target_key" "$source_var_name"
  done
}

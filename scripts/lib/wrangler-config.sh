#!/usr/bin/env bash
set -euo pipefail

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

escape_toml_string() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

update_toml_string_value() {
  local file="$1"
  local section="$2"
  local key="$3"
  local value="$4"
  local escaped
  local tmp

  escaped="$(escape_toml_string "$value")"
  tmp="$(mktemp)"

  awk -v section="$section" -v key="$key" -v value="$escaped" '
    BEGIN {
      inSection = (section == "")
    }
    {
      if (section == "") {
        if ($0 ~ /^\[/) {
          inSection = 0
        }
      } else if ($0 ~ /^\[/) {
        inSection = ($0 == section)
      }

      if (inSection && $0 ~ "^[[:space:]]*" key "[[:space:]]*=") {
        print key " = \"" value "\""
      } else {
        print $0
      }
    }
  ' "$file" >"$tmp"

  mv "$tmp" "$file"
}

update_toml_raw_value() {
  local file="$1"
  local section="$2"
  local key="$3"
  local raw_value="$4"
  local tmp

  tmp="$(mktemp)"

  awk -v section="$section" -v key="$key" -v rawValue="$raw_value" '
    BEGIN {
      inSection = (section == "")
    }
    {
      if (section == "") {
        if ($0 ~ /^\[/) {
          inSection = 0
        }
      } else if ($0 ~ /^\[/) {
        inSection = ($0 == section)
      }

      if (inSection && $0 ~ "^[[:space:]]*" key "[[:space:]]*=") {
        print key " = " rawValue
      } else {
        print $0
      }
    }
  ' "$file" >"$tmp"

  mv "$tmp" "$file"
}

build_toml_array_from_csv() {
  local csv="$1"
  local result=()
  local item
  local trimmed
  local escaped

  IFS=',' read -r -a items <<<"$csv"
  for item in "${items[@]}"; do
    trimmed="$(trim_whitespace "$item")"
    if [[ -z "$trimmed" ]]; then
      continue
    fi
    escaped="$(escape_toml_string "$trimmed")"
    result+=("\"$escaped\"")
  done

  if [[ "${#result[@]}" -eq 0 ]]; then
    printf '[]'
    return 0
  fi

  local joined=""
  local i
  for i in "${!result[@]}"; do
    if [[ "$i" -gt 0 ]]; then
      joined+=", "
    fi
    joined+="${result[$i]}"
  done

  printf '[%s]' "$joined"
}

create_wrangler_runtime_config() {
  local base_config="$1"
  local tag="${2:-wrangler-config}"
  local runtime_config
  local changed=false
  local cron_array
  local base_dir

  if [[ ! -f "$base_config" ]]; then
    return 1
  fi

  base_dir="$(cd "$(dirname "$base_config")" && pwd)"
  runtime_config="$(mktemp "$base_dir/.wrangler-runtime.XXXXXX.toml")"
  cp "$base_config" "$runtime_config"

  apply_string_override() {
    local env_key="$1"
    local section="$2"
    local toml_key="$3"
    local value="${!env_key:-}"

    if [[ -z "$value" ]]; then
      return
    fi

    update_toml_string_value "$runtime_config" "$section" "$toml_key" "$value"
    changed=true
    echo "[$tag] Wrangler override ${toml_key} from $env_key" >&2
  }

  apply_string_override "CF_WORKER_NAME" "" "name"
  apply_string_override "CF_WORKER_COMPATIBILITY_DATE" "" "compatibility_date"
  apply_string_override "CF_ASSETS_DIRECTORY" "[assets]" "directory"
  apply_string_override "CF_ASSETS_BINDING" "[assets]" "binding"
  apply_string_override "CF_D1_DATABASE_BINDING" "[[d1_databases]]" "binding"
  apply_string_override "CF_D1_DATABASE_NAME" "[[d1_databases]]" "database_name"
  apply_string_override "CF_D1_DATABASE_ID" "[[d1_databases]]" "database_id"

  if [[ -n "${CF_WORKER_CRONS:-}" ]]; then
    cron_array="$(build_toml_array_from_csv "$CF_WORKER_CRONS")"
    update_toml_raw_value "$runtime_config" "[triggers]" "crons" "$cron_array"
    changed=true
    echo "[$tag] Wrangler override crons from CF_WORKER_CRONS" >&2
  fi

  if [[ "$changed" == "true" ]]; then
    printf '%s' "$runtime_config"
    return 0
  fi

  rm -f "$runtime_config"
  printf '%s' "$base_config"
}

cleanup_wrangler_runtime_config() {
  local runtime_config="$1"
  local base_config="$2"

  if [[ -n "$runtime_config" && "$runtime_config" != "$base_config" ]]; then
    rm -f "$runtime_config"
  fi
}

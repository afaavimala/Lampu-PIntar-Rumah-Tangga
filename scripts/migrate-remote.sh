#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/root-env.sh"
source "$ROOT_DIR/scripts/lib/wrangler-config.sh"

resolve_optional_env_value() {
  local value
  if value="$(resolve_env_value_with_fallbacks "$@")"; then
    printf '%s' "$value"
    return 0
  fi
  printf ''
}

load_root_env "migrate-remote"

D1_DATABASE_NAME="$(resolve_optional_env_value "CF_D1_DATABASE_NAME")"
if [[ -z "$D1_DATABASE_NAME" ]]; then
  D1_DATABASE_NAME="smartlamp_db"
fi

WORKER_ENV="$(resolve_optional_env_value "CF_WORKER_ENV")"
MIGRATE_ARGS=("$D1_DATABASE_NAME" --remote)
WRANGLER_ENV_ARGS=()
WRANGLER_CONFIG="$ROOT_DIR/backend/wrangler.toml"
WRANGLER_CONFIG_RUNTIME=""

if [[ ! -f "$WRANGLER_CONFIG" ]]; then
  echo "[migrate-remote] Missing backend/wrangler.toml."
  echo "[migrate-remote] Create it from template:"
  echo "  cp backend/wrangler.toml.example backend/wrangler.toml"
  exit 1
fi

WRANGLER_CONFIG_RUNTIME="$(create_wrangler_runtime_config "$WRANGLER_CONFIG" "migrate-remote")"

cleanup() {
  cleanup_wrangler_runtime_config "$WRANGLER_CONFIG_RUNTIME" "$WRANGLER_CONFIG"
}

trap cleanup EXIT

if [[ -n "$WORKER_ENV" ]]; then
  MIGRATE_ARGS+=(--env "$WORKER_ENV")
  WRANGLER_ENV_ARGS+=(--env "$WORKER_ENV")
  echo "[migrate-remote] Using Worker env: $WORKER_ENV"
fi

run_wrangler() {
  (
    cd "$ROOT_DIR"
    npx wrangler -c "$WRANGLER_CONFIG_RUNTIME" "$@"
  )
}

d1_query_json() {
  local sql="$1"
  run_wrangler d1 execute "$D1_DATABASE_NAME" --remote "${WRANGLER_ENV_ARGS[@]}" --json --command "$sql"
}

json_has_result() {
  node -e '
    const chunks = []
    process.stdin.on("data", (chunk) => chunks.push(chunk))
    process.stdin.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const result = Array.isArray(payload) ? payload[0] : payload
      process.exit(result?.success && Array.isArray(result.results) && result.results.length > 0 ? 0 : 1)
    })
  '
}

table_exists() {
  local table_name="$1"
  d1_query_json "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '$table_name' LIMIT 1;" | json_has_result
}

column_exists() {
  local table_name="$1"
  local column_name="$2"
  d1_query_json "SELECT name FROM pragma_table_info('$table_name') WHERE name = '$column_name' LIMIT 1;" | json_has_result
}

ensure_column() {
  local table_name="$1"
  local column_name="$2"
  local definition_sql="$3"

  if ! table_exists "$table_name"; then
    echo "[migrate-remote] Table $table_name not found yet; baseline migration will create it."
    return
  fi

  if column_exists "$table_name" "$column_name"; then
    return
  fi

  echo "[migrate-remote] Adding missing column $table_name.$column_name"
  local output
  if ! output="$(
    run_wrangler d1 execute "$D1_DATABASE_NAME" --remote "${WRANGLER_ENV_ARGS[@]}" --command \
      "ALTER TABLE $table_name ADD COLUMN $column_name $definition_sql;" 2>&1
  )"; then
    if grep -qi "duplicate column" <<<"$output"; then
      echo "[migrate-remote] Column $table_name.$column_name already exists."
      return
    fi
    printf '%s\n' "$output" >&2
    return 1
  fi
  printf '%s\n' "$output"
}

echo "[migrate-remote] Preflighting remote D1 schema compatibility..."
ensure_column "users" "name" "TEXT NOT NULL DEFAULT ''"
ensure_column "users" "role" "TEXT NOT NULL DEFAULT 'member'"
ensure_column "users" "is_active" "INTEGER NOT NULL DEFAULT 1"
ensure_column "users" "updated_at" "TEXT"
ensure_column "users" "deleted_at" "TEXT"
ensure_column "users" "deleted_by_user_id" "INTEGER"
ensure_column "user_devices" "device_permission" "TEXT NOT NULL DEFAULT 'monitoring'"
ensure_column "user_devices" "schedule_permission" "TEXT NOT NULL DEFAULT 'none'"
ensure_column "user_devices" "assigned_by_user_id" "INTEGER"
ensure_column "user_devices" "updated_at" "TEXT"
ensure_column "device_schedules" "created_by_user_id" "INTEGER"
ensure_column "device_schedules" "window_group_id" "TEXT"
ensure_column "device_schedules" "window_start_minute" "INTEGER"
ensure_column "device_schedules" "window_end_minute" "INTEGER"
ensure_column "device_schedules" "enforce_every_minute" "INTEGER"

echo "[migrate-remote] Applying remote D1 migrations..."
run_wrangler d1 migrations apply "${MIGRATE_ARGS[@]}"

echo "[migrate-remote] Done."

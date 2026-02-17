import { resolve } from 'node:path'
import type { EnvBindings } from '../types/app'
import type { MariaDbRuntimeConfig } from './mariadb-d1'

export type ServerRuntimeConfig = {
  port: number
  schedulerEnabled: boolean
  schedulerIntervalMs: number
  serveDashboard: boolean
  frontendDistDir: string
  bindings: Omit<EnvBindings, 'DB'>
  db: MariaDbRuntimeConfig
}

function readRequired(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number) {
  const raw = env[key]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const raw = env[key]
  if (!raw) return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }
  return fallback
}

export function loadServerRuntimeConfig(env: NodeJS.ProcessEnv): ServerRuntimeConfig {
  const port = readNumber(env, 'PORT', 8787)
  const schedulerEnabled = readBoolean(env, 'SCHEDULER_ENABLED', true)
  const schedulerIntervalMs = readNumber(env, 'SCHEDULER_INTERVAL_MS', 60_000)
  const serveDashboard = readBoolean(env, 'SERVE_DASHBOARD', false)
  const frontendDistDir = env.FRONTEND_DIST_DIR?.trim()
    ? resolve(env.FRONTEND_DIST_DIR)
    : resolve(process.cwd(), '../dashboard/dist')

  const db: MariaDbRuntimeConfig = {
    host: env.DB_HOST?.trim() || '127.0.0.1',
    port: readNumber(env, 'DB_PORT', 3306),
    user: readRequired(env, 'DB_USER'),
    password: env.DB_PASSWORD ?? '',
    database: readRequired(env, 'DB_NAME'),
    connectionLimit: readNumber(env, 'DB_CONNECTION_LIMIT', 10),
  }

  const bindings: Omit<EnvBindings, 'DB'> = {
    JWT_SECRET: readRequired(env, 'JWT_SECRET'),
    HMAC_GLOBAL_FALLBACK_SECRET: env.HMAC_GLOBAL_FALLBACK_SECRET,
    MQTT_WS_URL: readRequired(env, 'MQTT_WS_URL'),
    MQTT_USERNAME: env.MQTT_USERNAME,
    MQTT_PASSWORD: env.MQTT_PASSWORD,
    MQTT_CLIENT_ID_PREFIX: env.MQTT_CLIENT_ID_PREFIX,
    JWT_ACCESS_TTL_SEC: env.JWT_ACCESS_TTL_SEC,
    JWT_REFRESH_TTL_SEC: env.JWT_REFRESH_TTL_SEC,
    COOKIE_SECURE: env.COOKIE_SECURE,
    COOKIE_SAME_SITE: env.COOKIE_SAME_SITE,
    COOKIE_DOMAIN: env.COOKIE_DOMAIN,
    CORS_ORIGINS: env.CORS_ORIGINS,
    AUTH_LOGIN_RATE_LIMIT_MAX: env.AUTH_LOGIN_RATE_LIMIT_MAX,
    AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC,
    COMMAND_SIGN_RATE_LIMIT_MAX: env.COMMAND_SIGN_RATE_LIMIT_MAX,
    COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC: env.COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC,
    SEED_ADMIN_EMAIL: env.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: env.SEED_ADMIN_PASSWORD,
    SEED_SAMPLE_DEVICE_ID: env.SEED_SAMPLE_DEVICE_ID,
  }

  return {
    port,
    schedulerEnabled,
    schedulerIntervalMs,
    serveDashboard,
    frontendDistDir,
    bindings,
    db,
  }
}

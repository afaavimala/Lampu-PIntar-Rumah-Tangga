import type { AppDatabase } from './db'

type WorkerAssetsBinding = {
  fetch: (request: Request) => Promise<Response>
}

export type EnvBindings = {
  DB: AppDatabase
  ASSETS?: WorkerAssetsBinding
  JWT_SECRET: string
  HMAC_GLOBAL_FALLBACK_SECRET?: string
  MQTT_WS_URL: string
  MQTT_USERNAME?: string
  MQTT_PASSWORD?: string
  MQTT_CLIENT_ID_PREFIX?: string
  JWT_ACCESS_TTL_SEC?: string
  JWT_REFRESH_TTL_SEC?: string
  COOKIE_SECURE?: string
  COOKIE_SAME_SITE?: string
  COOKIE_DOMAIN?: string
  CORS_ORIGINS?: string
  AUTH_LOGIN_RATE_LIMIT_MAX?: string
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC?: string
  COMMAND_SIGN_RATE_LIMIT_MAX?: string
  COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC?: string
  SEED_ADMIN_EMAIL?: string
  SEED_ADMIN_PASSWORD?: string
  SEED_SAMPLE_DEVICE_ID?: string
}

export type ApiKeyPrincipal = {
  kind: 'client'
  clientId: number
  name: string
  scopes: string[]
}

export type UserPrincipal = {
  kind: 'user'
  userId: number
  email: string
  scopes: string[]
}

export type Principal = UserPrincipal | ApiKeyPrincipal

export type AuthFailureReason = 'AUTH_INVALID_TOKEN' | 'AUTH_EXPIRED_TOKEN'

export type AppVariables = {
  requestId: string
  principal: Principal | null
  authFailureReason: AuthFailureReason | null
}

export type AppEnv = {
  Bindings: EnvBindings
  Variables: AppVariables
}

export type ApiErrorCode =
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_EXPIRED_TOKEN'
  | 'FORBIDDEN_DEVICE_ACCESS'
  | 'DEVICE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'SCHEDULE_NOT_FOUND'
  | 'SCHEDULE_INVALID_CRON'
  | 'SCHEDULE_INVALID_TIMEZONE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_AUTHENTICATED'
  | 'INTERNAL_ERROR'

export type CommandAction = 'ON' | 'OFF'

export type DeviceRecord = {
  id: number
  device_id: string
  name: string
  location: string | null
  hmac_secret: string | null
}

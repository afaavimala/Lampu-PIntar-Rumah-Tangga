import { sha256Hex } from './crypto'

export const ACCESS_TOKEN_COOKIE_NAME = 'auth_token'
export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token'

export function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

export function getAccessTtlSec(env: {
  JWT_ACCESS_TTL_SEC?: string
}) {
  return parsePositiveInt(env.JWT_ACCESS_TTL_SEC, 15 * 60)
}

export function getRefreshTtlSec(env: {
  JWT_REFRESH_TTL_SEC?: string
}) {
  return parsePositiveInt(env.JWT_REFRESH_TTL_SEC, 30 * 24 * 60 * 60)
}

export function createOpaqueRefreshToken(bytes = 48) {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function getRefreshTokenExpiryMs(ttlSec: number) {
  return Date.now() + ttlSec * 1000
}

export async function hashRefreshToken(token: string) {
  return sha256Hex(token)
}

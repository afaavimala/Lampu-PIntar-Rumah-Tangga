import type { Context } from 'hono'
import type { AppEnv } from '../types/app'

type RateLimitRow = {
  request_count: number
  reset_at: number
}

type ConsumeRateLimitInput = {
  bucket: string
  identifier: string
  limit: number
  windowSec: number
}

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterSec: number
  resetAt: number
}

function sanitizeKeyPart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9:._-]/g, '_')
}

export function readPositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

export function getClientIp(c: Context<AppEnv>) {
  const cfIp = c.req.header('cf-connecting-ip')
  if (cfIp && cfIp.trim()) {
    return cfIp.trim()
  }

  const forwardedFor = c.req.header('x-forwarded-for')
  if (forwardedFor && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() ?? 'unknown-ip'
  }

  return 'unknown-ip'
}

export async function consumeRateLimit(
  db: D1Database,
  input: ConsumeRateLimitInput,
): Promise<RateLimitResult> {
  if (input.limit <= 0) {
    return {
      allowed: true,
      limit: input.limit,
      remaining: input.limit,
      retryAfterSec: 0,
      resetAt: Date.now(),
    }
  }

  const now = Date.now()
  const windowMs = input.windowSec * 1000
  const resetAt = now + windowMs
  const rateKey = `${sanitizeKeyPart(input.bucket)}:${sanitizeKeyPart(input.identifier)}`
  const nowIso = new Date().toISOString()

  const existing = await db
    .prepare('SELECT request_count, reset_at FROM rate_limit_hits WHERE rate_key = ? LIMIT 1')
    .bind(rateKey)
    .first<RateLimitRow>()

  if (!existing || existing.reset_at <= now) {
    await db
      .prepare(
        `INSERT INTO rate_limit_hits (rate_key, request_count, reset_at, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(rate_key) DO UPDATE SET
           request_count = 1,
           reset_at = excluded.reset_at,
           updated_at = excluded.updated_at`,
      )
      .bind(rateKey, resetAt, nowIso, nowIso)
      .run()

    await maybeCleanupExpiredRateLimitRows(db, now)

    return {
      allowed: true,
      limit: input.limit,
      remaining: Math.max(0, input.limit - 1),
      retryAfterSec: 0,
      resetAt,
    }
  }

  if (existing.request_count >= input.limit) {
    return {
      allowed: false,
      limit: input.limit,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.reset_at - now) / 1000)),
      resetAt: existing.reset_at,
    }
  }

  const nextCount = existing.request_count + 1
  await db
    .prepare('UPDATE rate_limit_hits SET request_count = ?, updated_at = ? WHERE rate_key = ?')
    .bind(nextCount, nowIso, rateKey)
    .run()

  return {
    allowed: true,
    limit: input.limit,
    remaining: Math.max(0, input.limit - nextCount),
    retryAfterSec: 0,
    resetAt: existing.reset_at,
  }
}

export function applyRateLimitHeaders(c: Context<AppEnv>, result: RateLimitResult) {
  c.header('x-ratelimit-limit', String(result.limit))
  c.header('x-ratelimit-remaining', String(result.remaining))
  c.header('x-ratelimit-reset', String(Math.ceil(result.resetAt / 1000)))
  if (!result.allowed && result.retryAfterSec > 0) {
    c.header('retry-after', String(result.retryAfterSec))
  }
}

async function maybeCleanupExpiredRateLimitRows(db: D1Database, now: number) {
  if (Math.random() > 0.02) {
    return
  }

  await db.prepare('DELETE FROM rate_limit_hits WHERE reset_at <= ?').bind(now).run()
}

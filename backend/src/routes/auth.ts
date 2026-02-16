import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppEnv } from '../types/app'
import { parseJsonBody } from '../lib/body'
import {
  createAuthSession,
  findAuthSessionByRefreshTokenHash,
  getUserByEmail,
  revokeAuthSessionByRefreshTokenHash,
  rotateAuthSession,
  updateUserPasswordHash,
} from '../lib/db'
import { createUserJwt } from '../lib/auth'
import { fail, ok } from '../lib/response'
import { verifyPassword } from '../lib/password'
import { applyRateLimitHeaders, consumeRateLimit, getClientIp, readPositiveInt } from '../lib/rate-limit'
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  createOpaqueRefreshToken,
  getAccessTtlSec,
  getRefreshTokenExpiryMs,
  getRefreshTtlSec,
  hashRefreshToken,
} from '../lib/session'

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
})

export const authRoutes = new Hono<AppEnv>()

function resolveSameSite(raw?: string): 'Strict' | 'Lax' | 'None' {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'lax') return 'Lax'
  if (value === 'none') return 'None'
  return 'Strict'
}

function getCookieBaseOptions(c: Context<AppEnv>) {
  const secureCookie = (c.env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true'
  const sameSite = resolveSameSite(c.env.COOKIE_SAME_SITE)
  const cookieDomain = c.env.COOKIE_DOMAIN?.trim()

  return {
    httpOnly: true as const,
    secure: secureCookie,
    sameSite,
    path: '/',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  }
}

function clearSessionCookies(c: Context<AppEnv>) {
  const options = getCookieBaseOptions(c)
  deleteCookie(c, ACCESS_TOKEN_COOKIE_NAME, {
    path: '/',
    ...(options.domain ? { domain: options.domain } : {}),
  })
  deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, {
    path: '/',
    ...(options.domain ? { domain: options.domain } : {}),
  })
}

function setSessionCookies(
  c: Context<AppEnv>,
  input: { accessToken: string; refreshToken: string },
) {
  const options = getCookieBaseOptions(c)
  setCookie(c, ACCESS_TOKEN_COOKIE_NAME, input.accessToken, {
    ...options,
    maxAge: getAccessTtlSec(c.env),
  })
  setCookie(c, REFRESH_TOKEN_COOKIE_NAME, input.refreshToken, {
    ...options,
    maxAge: getRefreshTtlSec(c.env),
  })
}

authRoutes.post('/login', async (c) => {
  const loginRateLimit = await consumeRateLimit(c.env.DB, {
    bucket: 'auth_login',
    identifier: getClientIp(c),
    limit: readPositiveInt(c.env.AUTH_LOGIN_RATE_LIMIT_MAX, 8),
    windowSec: readPositiveInt(c.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC, 60),
  })
  applyRateLimitHeaders(c, loginRateLimit)
  if (!loginRateLimit.allowed) {
    return fail(c, 'RATE_LIMITED', 'Too many login attempts', 429, {
      retryAfterSec: loginRateLimit.retryAfterSec,
    })
  }

  const parsed = await parseJsonBody(c, loginSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const user = await getUserByEmail(c.env.DB, parsed.data.email)
  if (!user) {
    return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid email or password', 401)
  }

  const verification = await verifyPassword(parsed.data.password, user.password_hash)
  if (!verification.ok) {
    return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid email or password', 401)
  }

  if (verification.needsRehash && verification.upgradedHash) {
    await updateUserPasswordHash(c.env.DB, user.id, verification.upgradedHash)
  }

  const token = await createUserJwt(c, {
    userId: user.id,
    email: user.email,
  })

  const refreshToken = createOpaqueRefreshToken()
  const refreshTokenHash = await hashRefreshToken(refreshToken)
  const refreshTtlSec = getRefreshTtlSec(c.env)

  await createAuthSession(c.env.DB, {
    userId: user.id,
    refreshTokenHash,
    expiresAt: getRefreshTokenExpiryMs(refreshTtlSec),
    userAgent: c.req.header('user-agent') ?? null,
    ipAddress: getClientIp(c),
  })

  setSessionCookies(c, {
    accessToken: token,
    refreshToken,
  })

  return ok(c, {
    user: {
      id: user.id,
      email: user.email,
    },
  })
})

authRoutes.post('/refresh', async (c) => {
  const rawRefreshToken = getCookie(c, REFRESH_TOKEN_COOKIE_NAME)
  if (!rawRefreshToken) {
    clearSessionCookies(c)
    return fail(c, 'AUTH_INVALID_TOKEN', 'Refresh token is required', 401)
  }

  const refreshTokenHash = await hashRefreshToken(rawRefreshToken)
  const session = await findAuthSessionByRefreshTokenHash(c.env.DB, refreshTokenHash)
  if (!session) {
    clearSessionCookies(c)
    return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid refresh token', 401)
  }

  const now = Date.now()
  if (session.revoked_at != null || session.rotated_at != null) {
    clearSessionCookies(c)
    return fail(c, 'AUTH_INVALID_TOKEN', 'Refresh token has been revoked', 401)
  }

  if (session.expires_at <= now) {
    await revokeAuthSessionByRefreshTokenHash(c.env.DB, refreshTokenHash)
    clearSessionCookies(c)
    return fail(c, 'AUTH_EXPIRED_TOKEN', 'Refresh token expired', 401)
  }

  const replacementRefreshToken = createOpaqueRefreshToken()
  const replacementRefreshTokenHash = await hashRefreshToken(replacementRefreshToken)
  const refreshTtlSec = getRefreshTtlSec(c.env)
  const replacementSessionId = await createAuthSession(c.env.DB, {
    userId: session.user_id,
    refreshTokenHash: replacementRefreshTokenHash,
    expiresAt: getRefreshTokenExpiryMs(refreshTtlSec),
    userAgent: c.req.header('user-agent') ?? null,
    ipAddress: getClientIp(c),
  })

  await rotateAuthSession(c.env.DB, {
    previousSessionId: session.session_id,
    replacementSessionId,
    rotatedAt: now,
  })

  const accessToken = await createUserJwt(c, {
    userId: session.user_id,
    email: session.email,
  })

  setSessionCookies(c, {
    accessToken,
    refreshToken: replacementRefreshToken,
  })

  return ok(c, {
    refreshed: true,
    user: {
      id: session.user_id,
      email: session.email,
    },
  })
})

authRoutes.post('/logout', async (c) => {
  const rawRefreshToken = getCookie(c, REFRESH_TOKEN_COOKIE_NAME)
  if (rawRefreshToken) {
    const refreshTokenHash = await hashRefreshToken(rawRefreshToken)
    await revokeAuthSessionByRefreshTokenHash(c.env.DB, refreshTokenHash)
  }

  clearSessionCookies(c)

  return ok(c, { loggedOut: true })
})

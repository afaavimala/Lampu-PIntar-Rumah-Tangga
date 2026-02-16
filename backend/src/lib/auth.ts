import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import type { JwtVariables } from 'hono/jwt'
import { getApiClientByHash, getUserById } from './db'
import { sha256Hex } from './crypto'
import type { AppEnv, AuthFailureReason, Principal } from '../types/app'
import { ACCESS_TOKEN_COOKIE_NAME, getAccessTtlSec } from './session'

type UserJwtPayload = JwtVariables & {
  sub: string
  email: string
  type: 'user'
}

type JwtVerificationResult = {
  principal: Principal | null
  failureReason: AuthFailureReason | null
}

export type ResolvePrincipalResult = {
  principal: Principal | null
  failureReason: AuthFailureReason | null
}

export async function createUserJwt(c: Context<AppEnv>, payload: { userId: number; email: string }) {
  const nowSec = Math.floor(Date.now() / 1000)
  const accessTtlSec = getAccessTtlSec(c.env)
  return sign(
    {
      sub: String(payload.userId),
      email: payload.email,
      type: 'user',
      iat: nowSec,
      exp: nowSec + accessTtlSec,
    },
    c.env.JWT_SECRET,
  )
}

async function verifyUserJwt(c: Context<AppEnv>, token: string): Promise<JwtVerificationResult> {
  try {
    const decoded = (await verify(token, c.env.JWT_SECRET, 'HS256')) as UserJwtPayload
    if (decoded.type !== 'user' || !decoded.sub) {
      return { principal: null, failureReason: 'AUTH_INVALID_TOKEN' }
    }

    const user = await getUserById(c.env.DB, Number(decoded.sub))
    if (!user) {
      return { principal: null, failureReason: 'AUTH_INVALID_TOKEN' }
    }

    return {
      principal: {
        kind: 'user',
        userId: user.id,
        email: user.email,
        scopes: ['*'],
      },
      failureReason: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('expired') || message.includes('exp')) {
      return { principal: null, failureReason: 'AUTH_EXPIRED_TOKEN' }
    }
    return { principal: null, failureReason: 'AUTH_INVALID_TOKEN' }
  }
}

async function verifyApiKey(c: Context<AppEnv>, rawKey: string): Promise<Principal | null> {
  const hash = await sha256Hex(rawKey)
  const client = await getApiClientByHash(c.env.DB, hash)
  if (!client) {
    return null
  }

  return {
    kind: 'client',
    clientId: client.id,
    name: client.name,
    scopes: client.scopes,
  }
}

export async function resolvePrincipal(c: Context<AppEnv>): Promise<ResolvePrincipalResult> {
  const authHeader = c.req.header('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  const cookieToken = getCookie(c, ACCESS_TOKEN_COOKIE_NAME)

  const token = bearerToken ?? cookieToken ?? null
  if (!token) {
    return { principal: null, failureReason: null }
  }

  const userAuth = await verifyUserJwt(c, token)
  if (userAuth.principal) {
    return { principal: userAuth.principal, failureReason: null }
  }

  if (bearerToken) {
    const apiKeyPrincipal = await verifyApiKey(c, bearerToken)
    if (apiKeyPrincipal) {
      return { principal: apiKeyPrincipal, failureReason: null }
    }
  }

  return {
    principal: null,
    failureReason: userAuth.failureReason ?? 'AUTH_INVALID_TOKEN',
  }
}

export function hasScope(principal: Principal, scope: string) {
  if (principal.kind === 'user') {
    return true
  }

  return principal.scopes.includes(scope) || principal.scopes.includes('*')
}

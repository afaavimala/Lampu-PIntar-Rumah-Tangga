import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types/app'
import { resolvePrincipal, hasScope } from '../lib/auth'
import { fail } from '../lib/response'

export const authResolverMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authResult = await resolvePrincipal(c)
  c.set('principal', authResult.principal)
  c.set('authFailureReason', authResult.failureReason)
  await next()
}

export function requireAuth(requiredScopes: string[] = []): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal')
    if (!principal) {
      const failureReason = c.get('authFailureReason')
      if (failureReason === 'AUTH_EXPIRED_TOKEN') {
        return fail(c, 'AUTH_EXPIRED_TOKEN', 'Token expired', 401)
      }
      if (failureReason === 'AUTH_INVALID_TOKEN') {
        return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid token', 401)
      }
      return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
    }

    for (const scope of requiredScopes) {
      if (!hasScope(principal, scope)) {
        return fail(c, 'FORBIDDEN_DEVICE_ACCESS', 'Required scope is missing', 403, { scope })
      }
    }

    await next()
  }
}

export function requireUserAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const principal = c.get('principal')
    if (!principal) {
      const failureReason = c.get('authFailureReason')
      if (failureReason === 'AUTH_EXPIRED_TOKEN') {
        return fail(c, 'AUTH_EXPIRED_TOKEN', 'Token expired', 401)
      }
      if (failureReason === 'AUTH_INVALID_TOKEN') {
        return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid token', 401)
      }
      return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
    }

    if (principal.kind !== 'user') {
      return fail(c, 'FORBIDDEN_DEVICE_ACCESS', 'User JWT required for this endpoint', 403)
    }

    await next()
  }
}

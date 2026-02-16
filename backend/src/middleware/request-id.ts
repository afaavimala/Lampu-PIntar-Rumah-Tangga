import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types/app'

export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id')
  const requestId = incoming && incoming.trim().length > 0 ? incoming : crypto.randomUUID()

  c.set('requestId', requestId)
  c.set('principal', null)
  c.set('authFailureReason', null)

  await next()

  c.header('x-request-id', requestId)
}

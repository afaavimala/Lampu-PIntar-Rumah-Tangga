import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, CommandAction } from '../types/app'
import { parseJsonBody } from '../lib/body'
import { fail, buildSuccessEnvelope, ok } from '../lib/response'
import { requireAuth } from '../middleware/auth'
import { beginIdempotentRequest, persistIdempotentResponse } from '../lib/idempotency'
import { createSignedEnvelope, logCommandSignature } from '../lib/commands'
import { resolveDeviceAccess } from '../lib/db'
import { applyRateLimitHeaders, consumeRateLimit, getClientIp, readPositiveInt } from '../lib/rate-limit'

const commandSchema = z.object({
  deviceId: z.string().min(1),
  action: z.enum(['ON', 'OFF']),
  requestId: z.string().min(1),
})

export const commandRoutes = new Hono<AppEnv>()

commandRoutes.post('/sign', requireAuth(['command']), async (c) => {
  const parsed = await parseJsonBody(c, commandSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const idempotency = await beginIdempotentRequest(c, '/api/v1/commands/sign', parsed.raw)
  if (idempotency.kind === 'error') {
    return fail(c, 'IDEMPOTENCY_CONFLICT', 'Invalid idempotency request', 409, {
      reason: idempotency.code,
    })
  }

  if (idempotency.kind === 'replay') {
    return c.json(idempotency.payload, idempotency.statusCode as any)
  }

  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const subjectId = principal.kind === 'user' ? `user:${principal.userId}` : `client:${principal.clientId}`
  const signRateLimit = await consumeRateLimit(c.env.DB, {
    bucket: 'command_sign',
    identifier: `${subjectId}:${getClientIp(c)}`,
    limit: readPositiveInt(c.env.COMMAND_SIGN_RATE_LIMIT_MAX, 30),
    windowSec: readPositiveInt(c.env.COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC, 60),
  })
  applyRateLimitHeaders(c, signRateLimit)
  if (!signRateLimit.allowed) {
    return fail(c, 'RATE_LIMITED', 'Too many sign requests', 429, {
      retryAfterSec: signRateLimit.retryAfterSec,
    })
  }

  const deviceAccess = await resolveDeviceAccess(c.env.DB, principal, parsed.data.deviceId)
  if (deviceAccess.access === 'not_found') {
    return fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404)
  }
  if (deviceAccess.access === 'forbidden') {
    return fail(c, 'FORBIDDEN_DEVICE_ACCESS', 'No access to this device', 403)
  }
  const device = deviceAccess.device
  if (!device) {
    return fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404)
  }

  const hmacSecret = device.hmac_secret ?? c.env.HMAC_GLOBAL_FALLBACK_SECRET
  if (!hmacSecret) {
    return fail(c, 'INTERNAL_ERROR', 'No signing secret configured for device', 500)
  }

  const envelope = await createSignedEnvelope({
    deviceId: parsed.data.deviceId,
    action: parsed.data.action as CommandAction,
    requestId: parsed.data.requestId,
    hmacSecret,
  })

  await logCommandSignature({
    db: c.env.DB,
    userId: principal.kind === 'user' ? principal.userId : null,
    deviceInternalId: device.id,
    requestId: envelope.requestId,
    action: envelope.action,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    result: 'SIGNED',
  })

  const payload = buildSuccessEnvelope(c, envelope)
  await persistIdempotentResponse(c, idempotency, 200, payload)
  return ok(c, envelope)
})

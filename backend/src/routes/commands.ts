import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv, CommandAction } from '../types/app'
import { parseJsonBody } from '../lib/body'
import { fail, buildSuccessEnvelope, ok } from '../lib/response'
import { requireAuth } from '../middleware/auth'
import { beginIdempotentRequest, persistIdempotentResponse } from '../lib/idempotency'
import { createCommandEnvelope, logCommandDispatch } from '../lib/commands'
import { resolveDeviceAccess } from '../lib/db'
import { applyRateLimitHeaders, consumeRateLimit, getClientIp, readPositiveInt } from '../lib/rate-limit'
import { getRealtimeMqttProxy, initializeRealtimeMqttProxy } from '../lib/realtime-mqtt-proxy'

const commandSchema = z.object({
  deviceId: z.string().min(1),
  action: z.enum(['ON', 'OFF']),
  requestId: z.string().min(1),
})

export const commandRoutes = new Hono<AppEnv>()

async function resolveCommandContext(c: Context<AppEnv>, input: {
  deviceId: string
  action: 'ON' | 'OFF'
  requestId: string
}) {
  const principal = c.get('principal')
  if (!principal) {
    return {
      ok: false as const,
      response: fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401),
    }
  }

  const subjectId = principal.kind === 'user' ? `user:${principal.userId}` : `client:${principal.clientId}`
  const commandRateLimit = await consumeRateLimit(c.env.DB, {
    bucket: 'command_execute',
    identifier: `${subjectId}:${getClientIp(c)}`,
    limit: readPositiveInt(c.env.COMMAND_EXECUTE_RATE_LIMIT_MAX, 30),
    windowSec: readPositiveInt(c.env.COMMAND_EXECUTE_RATE_LIMIT_WINDOW_SEC, 60),
  })
  applyRateLimitHeaders(c, commandRateLimit)
  if (!commandRateLimit.allowed) {
    return {
      ok: false as const,
      response: fail(c, 'RATE_LIMITED', 'Too many command requests', 429, {
        retryAfterSec: commandRateLimit.retryAfterSec,
      }),
    }
  }

  const deviceAccess = await resolveDeviceAccess(c.env.DB, principal, input.deviceId)
  if (deviceAccess.access === 'not_found') {
    return {
      ok: false as const,
      response: fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404),
    }
  }
  if (deviceAccess.access === 'forbidden') {
    return {
      ok: false as const,
      response: fail(c, 'FORBIDDEN_DEVICE_ACCESS', 'No access to this device', 403),
    }
  }
  const device = deviceAccess.device
  if (!device) {
    return {
      ok: false as const,
      response: fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404),
    }
  }

  const envelope = createCommandEnvelope({
    deviceId: input.deviceId,
    action: input.action as CommandAction,
    requestId: input.requestId,
  })

  return {
    ok: true as const,
    principal,
    device,
    envelope,
  }
}

commandRoutes.post('/execute', requireAuth(['command']), async (c) => {
  const parsed = await parseJsonBody(c, commandSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const idempotency = await beginIdempotentRequest(c, '/api/v1/commands/execute', parsed.raw)
  if (idempotency.kind === 'error') {
    return fail(c, 'IDEMPOTENCY_CONFLICT', 'Invalid idempotency request', 409, {
      reason: idempotency.code,
    })
  }

  if (idempotency.kind === 'replay') {
    return c.json(idempotency.payload, idempotency.statusCode as any)
  }

  const context = await resolveCommandContext(c, parsed.data)
  if (!context.ok) {
    return context.response
  }

  try {
    const proxy = getRealtimeMqttProxy() ?? initializeRealtimeMqttProxy({
      url: c.env.MQTT_WS_URL,
      username: c.env.MQTT_USERNAME,
      password: c.env.MQTT_PASSWORD,
      clientIdPrefix: c.env.MQTT_CLIENT_ID_PREFIX,
    })
    await proxy.publishCommand(context.envelope)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to publish command'
    return fail(c, 'INTERNAL_ERROR', message, 502)
  }

  await logCommandDispatch({
    db: c.env.DB,
    userId: context.principal.kind === 'user' ? context.principal.userId : null,
    deviceInternalId: context.device.id,
    requestId: context.envelope.requestId,
    action: context.envelope.action,
    result: 'PUBLISHED',
  })

  const payload = buildSuccessEnvelope(c, context.envelope)
  await persistIdempotentResponse(c, idempotency, 200, payload)
  return ok(c, context.envelope)
})

import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/app'
import { requireAuth, requireUserAuth } from '../middleware/auth'
import { parseJsonBody } from '../lib/body'
import { beginIdempotentRequest, persistIdempotentResponse } from '../lib/idempotency'
import { buildSuccessEnvelope, fail, ok } from '../lib/response'
import { listDevicesByPrincipal, resolveDeviceAccess } from '../lib/db'
import { getBestStatusForDevice } from '../lib/status'
import { readTasmotaDiscoveryOverWs } from '../lib/mqtt-ws'

export const integrationRoutes = new Hono<AppEnv>()

function readBoundedInt(
  value: string | undefined,
  fallback: number,
  bounds: {
    min: number
    max: number
  },
) {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const rounded = Math.floor(parsed)
  if (rounded < bounds.min) {
    return bounds.min
  }
  if (rounded > bounds.max) {
    return bounds.max
  }
  return rounded
}

function deriveSuggestedDeviceName(deviceId: string) {
  const normalized = deviceId
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return 'Lampu Tasmota'
  }

  const words = normalized
    .split(' ')
    .map((word) => {
      if (!word) return ''
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .filter(Boolean)
  return words.join(' ')
}

const createDeviceSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
})

integrationRoutes.get('/integrations/capabilities', requireAuth(['read']), async (c) => {
  return ok(c, {
    version: 'v1',
    scopes: ['read', 'command', 'schedule'],
    endpoints: [
      '/api/v1/integrations/capabilities',
      '/api/v1/devices',
      '/api/v1/devices/discovery',
      '/api/v1/devices/{deviceId}',
      '/api/v1/devices/{deviceId}/status',
      '/api/v1/schedules',
      '/api/v1/schedules/{scheduleId}',
      '/api/v1/schedules/{scheduleId}/runs',
      '/api/v1/openapi.json',
    ],
  })
})

integrationRoutes.get('/devices/discovery', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const waitMs = readBoundedInt(c.req.query('waitMs'), 1_200, { min: 300, max: 5_000 })
  const maxDevices = readBoundedInt(c.req.query('maxDevices'), 200, { min: 1, max: 500 })

  let discovered
  try {
    discovered = await readTasmotaDiscoveryOverWs({
      url: c.env.MQTT_WS_URL,
      username: c.env.MQTT_USERNAME,
      password: c.env.MQTT_PASSWORD,
      clientIdPrefix: c.env.MQTT_CLIENT_ID_PREFIX,
      snapshotWaitMs: waitMs,
      maxDevices,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan Tasmota devices'
    return fail(c, 'INTERNAL_ERROR', message, 502)
  }

  const [ownedDevices, allRegistered] = await Promise.all([
    listDevicesByPrincipal(c.env.DB, principal),
    c.env.DB.prepare('SELECT device_id FROM devices').all<{ device_id: string }>(),
  ])

  const ownedDeviceIds = new Set(ownedDevices.map((device) => device.device_id.toLowerCase()))
  const registeredDeviceIds = new Set(allRegistered.results.map((row) => row.device_id.toLowerCase()))

  const devices = discovered.map((item) => {
    const key = item.deviceId.toLowerCase()
    const alreadyLinked = ownedDeviceIds.has(key)
    const alreadyRegistered = registeredDeviceIds.has(key)

    return {
      deviceId: item.deviceId,
      online: item.online,
      power: item.power,
      sources: item.sources,
      lastSeenAt: new Date(item.lastSeenAt).toISOString(),
      suggestedName: deriveSuggestedDeviceName(item.deviceId),
      alreadyLinked,
      alreadyRegistered,
    }
  })

  return ok(c, {
    scannedAt: new Date().toISOString(),
    waitMs,
    maxDevices,
    devices,
  })
})

integrationRoutes.post('/devices', requireUserAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'User authentication required', 401)
  }

  const parsed = await parseJsonBody(c, createDeviceSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const idempotency = await beginIdempotentRequest(c, '/api/v1/devices:POST', parsed.raw)
  if (idempotency.kind === 'error') {
    return fail(c, 'IDEMPOTENCY_CONFLICT', 'Invalid idempotency request', 409, {
      reason: idempotency.code,
    })
  }
  if (idempotency.kind === 'replay') {
    return c.json(idempotency.payload, idempotency.statusCode as any)
  }

  const existingDevice = await c.env.DB
    .prepare('SELECT id FROM devices WHERE device_id = ? LIMIT 1')
    .bind(parsed.data.deviceId)
    .first<{ id: number }>()

  if (existingDevice) {
    return fail(c, 'VALIDATION_ERROR', 'Device ID already exists', 409)
  }

  const nowIso = new Date().toISOString()
  const normalizedLocation = parsed.data.location?.trim() ? parsed.data.location.trim() : null
  const legacySecretPlaceholder = 'unused-tasmota'

  const createdDevice = await c.env.DB
    .prepare(
      `INSERT INTO devices (device_id, name, location, hmac_secret, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(parsed.data.deviceId, parsed.data.name, normalizedLocation, legacySecretPlaceholder, nowIso)
    .run()

  const deviceInternalId = Number(createdDevice.meta.last_row_id)
  await c.env.DB
    .prepare(
      `INSERT INTO user_devices (user_id, device_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`,
    )
    .bind(principal.userId, deviceInternalId, nowIso)
    .run()

  const payload = buildSuccessEnvelope(c, {
    id: parsed.data.deviceId,
    name: parsed.data.name,
    location: normalizedLocation,
  })
  await persistIdempotentResponse(c, idempotency, 201, payload)
  return c.json(payload, 201)
})

integrationRoutes.get('/devices', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const devices = await listDevicesByPrincipal(c.env.DB, principal)
  return ok(
    c,
    devices.map((device) => ({
      id: device.device_id,
      name: device.name,
      location: device.location,
    })),
  )
})

integrationRoutes.get('/devices/:deviceId', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const deviceAccess = await resolveDeviceAccess(c.env.DB, principal, c.req.param('deviceId'))
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

  return ok(c, {
    id: device.device_id,
    name: device.name,
    location: device.location,
  })
})

integrationRoutes.get('/devices/:deviceId/status', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const deviceAccess = await resolveDeviceAccess(c.env.DB, principal, c.req.param('deviceId'))
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

  const status = await getBestStatusForDevice(c.env.DB, device.id, device.device_id)
  return ok(c, status)
})

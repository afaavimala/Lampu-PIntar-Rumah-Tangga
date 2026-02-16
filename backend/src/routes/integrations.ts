import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { requireAuth } from '../middleware/auth'
import { fail, ok } from '../lib/response'
import { listDevicesByPrincipal, resolveDeviceAccess } from '../lib/db'
import { getBestStatusForDevice } from '../lib/status'

export const integrationRoutes = new Hono<AppEnv>()

integrationRoutes.get('/integrations/capabilities', requireAuth(['read']), async (c) => {
  return ok(c, {
    version: 'v1',
    scopes: ['read', 'command', 'schedule'],
    endpoints: [
      '/api/v1/integrations/capabilities',
      '/api/v1/devices',
      '/api/v1/devices/{deviceId}',
      '/api/v1/devices/{deviceId}/status',
      '/api/v1/schedules',
      '/api/v1/schedules/{scheduleId}',
      '/api/v1/schedules/{scheduleId}/runs',
      '/api/v1/openapi.json',
    ],
  })
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

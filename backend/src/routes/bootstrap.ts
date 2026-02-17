import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { requireAuth } from '../middleware/auth'
import { ok } from '../lib/response'
import { listDevicesByPrincipal } from '../lib/db'

export const bootstrapRoutes = new Hono<AppEnv>()

bootstrapRoutes.get('/', requireAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return ok(c, { devices: [], realtime: null })
  }

  const devices = await listDevicesByPrincipal(c.env.DB, principal)

  return ok(c, {
    devices: devices.map((device) => ({
      id: device.device_id,
      name: device.name,
      location: device.location,
    })),
    realtime: {
      mode: 'proxy_sse',
      streamPath: '/api/v1/realtime/stream',
    },
  })
})

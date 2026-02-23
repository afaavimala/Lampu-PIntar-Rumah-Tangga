import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { ok } from '../lib/response'
import { listDevicesByPrincipal } from '../lib/db'

export const bootstrapRoutes = new Hono<AppEnv>()

bootstrapRoutes.get('/', async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return ok(c, { devices: [], viewer: null, realtime: null })
  }

  const devices = await listDevicesByPrincipal(c.env.DB, principal)
  const viewer =
    principal.kind === 'user'
      ? {
          kind: 'user' as const,
          id: principal.userId,
          email: principal.email,
        }
      : {
          kind: 'client' as const,
          id: principal.clientId,
          name: principal.name,
        }

  return ok(c, {
    devices: devices.map((device) => ({
      id: device.device_id,
      name: device.name,
      location: device.location,
      commandChannel: device.command_channel,
    })),
    viewer,
    realtime: {
      mode: 'proxy_sse',
      streamPath: '/api/v1/realtime/stream',
    },
  })
})

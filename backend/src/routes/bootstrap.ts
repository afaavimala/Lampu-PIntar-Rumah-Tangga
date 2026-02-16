import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { requireAuth } from '../middleware/auth'
import { ok } from '../lib/response'
import { listDevicesByPrincipal } from '../lib/db'

export const bootstrapRoutes = new Hono<AppEnv>()

bootstrapRoutes.get('/', requireAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return ok(c, { devices: [], mqtt: null })
  }

  const devices = await listDevicesByPrincipal(c.env.DB, principal)

  return ok(c, {
    devices: devices.map((device) => ({
      id: device.device_id,
      name: device.name,
      location: device.location,
    })),
    mqtt: {
      wsUrl: c.env.MQTT_WS_URL,
      username: c.env.MQTT_USERNAME ?? '',
      password: c.env.MQTT_PASSWORD ?? '',
      clientIdPrefix: c.env.MQTT_CLIENT_ID_PREFIX ?? 'smartlamp-web',
      topics: {
        command: 'home/{deviceId}/cmd',
        status: 'home/{deviceId}/status',
        lwt: 'home/{deviceId}/lwt',
      },
    },
  })
})

import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { requireAuth } from '../middleware/auth'
import { fail } from '../lib/response'
import { listBestStatus } from '../lib/status'
import { listDevicesByPrincipal } from '../lib/db'
import { RealtimeMqttProxy, getRealtimeMqttProxy } from '../lib/realtime-mqtt-proxy'
import { readLwtSnapshotOverWs } from '../lib/mqtt-ws'

export const realtimeRoutes = new Hono<AppEnv>()

realtimeRoutes.get('/stream', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const proxy = getRealtimeMqttProxy()
  const devices = await listDevicesByPrincipal(c.env.DB, principal)
  const deviceIds = devices.map((device) => device.device_id)
  const initialStatuses = await listBestStatus(c.env.DB, principal)

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      let closed = false

      const send = (payload: unknown) => {
        if (closed) {
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      send({
        type: 'hello',
        ts: Date.now(),
      })

      const lastStatusMap = new Map<string, string>()
      const lastLwtMap = new Map<string, string>()

      const statusSignature = (payload: Record<string, unknown>) => {
        const power = typeof payload.power === 'string' ? payload.power : ''
        const ts = typeof payload.ts === 'number' ? String(payload.ts) : ''
        const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : ''
        const source = typeof payload.source === 'string' ? payload.source : ''
        const reason = typeof payload.reason === 'string' ? payload.reason : ''
        const requestId = typeof payload.requestId === 'string' ? payload.requestId : ''
        return `${power}|${ts}|${updatedAt}|${source}|${reason}|${requestId}`
      }

      const emitStatus = (deviceId: string, payload: Record<string, unknown>, ts: number) => {
        const signature = statusSignature(payload)
        if (lastStatusMap.get(deviceId) === signature) {
          return
        }

        lastStatusMap.set(deviceId, signature)
        send({
          type: 'status',
          deviceId,
          payload,
          ts,
        })
      }

      const emitLwt = (deviceId: string, payload: string, ts: number) => {
        const normalized = payload.trim().toUpperCase()
        if (!normalized) {
          return
        }
        if (lastLwtMap.get(deviceId) === normalized) {
          return
        }

        lastLwtMap.set(deviceId, normalized)
        send({
          type: 'lwt',
          deviceId,
          payload: normalized,
          ts,
        })
      }

      for (const status of initialStatuses) {
        emitStatus(
          status.deviceId,
          {
            power: status.power,
            updatedAt: status.updatedAt,
            source: status.source,
          },
          Date.now(),
        )
      }

      let streamProxy = proxy
      let ownedProxy: RealtimeMqttProxy | null = null
      if (!streamProxy) {
        ownedProxy = new RealtimeMqttProxy({
          url: c.env.MQTT_WS_URL,
          username: c.env.MQTT_USERNAME,
          password: c.env.MQTT_PASSWORD,
          clientIdPrefix: c.env.MQTT_CLIENT_ID_PREFIX,
        })
        ownedProxy.start()
        streamProxy = ownedProxy
      }

      let unsubscribe = () => {}

      unsubscribe = streamProxy.subscribe(deviceIds, (event) => {
        if (event.type === 'status') {
          emitStatus(event.deviceId, event.payload, event.ts)
          return
        }

        emitLwt(event.deviceId, event.payload, event.ts)
      })

      void (async () => {
        try {
          const lwtSnapshot = await readLwtSnapshotOverWs({
            url: c.env.MQTT_WS_URL,
            username: c.env.MQTT_USERNAME,
            password: c.env.MQTT_PASSWORD,
            clientIdPrefix: c.env.MQTT_CLIENT_ID_PREFIX,
            deviceIds,
          })

          for (const [deviceId, payload] of Object.entries(lwtSnapshot)) {
            emitLwt(deviceId, payload, Date.now())
          }
        } catch {
          // ignore mqtt snapshot error for stream stability
        }
      })()

      const heartbeat = setInterval(() => {
        send({
          type: 'ping',
          ts: Date.now(),
        })
      }, 15_000)

      const cleanup = () => {
        if (closed) {
          return
        }
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        ownedProxy?.stop()
        try {
          controller.close()
        } catch {
          // stream may already be closed
        }
      }

      c.req.raw.signal.addEventListener('abort', cleanup, { once: true })
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})

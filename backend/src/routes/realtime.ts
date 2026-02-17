import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { requireAuth } from '../middleware/auth'
import { fail } from '../lib/response'
import { listBestStatus } from '../lib/status'
import { listDevicesByPrincipal } from '../lib/db'
import { getRealtimeMqttProxy } from '../lib/realtime-mqtt-proxy'

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
      for (const status of initialStatuses) {
        const signature = `${status.power}|${status.updatedAt ?? ''}|${status.source}`
        lastStatusMap.set(status.deviceId, signature)
        send({
          type: 'status',
          deviceId: status.deviceId,
          payload: {
            power: status.power,
            updatedAt: status.updatedAt,
            source: status.source,
          },
          ts: Date.now(),
        })
      }

      let unsubscribe = () => {}
      let pollingTimer: ReturnType<typeof setInterval> | null = null

      if (proxy) {
        unsubscribe = proxy.subscribe(deviceIds, (event) => {
          send(event)
        })
      } else {
        pollingTimer = setInterval(() => {
          void (async () => {
            const statuses = await listBestStatus(c.env.DB, principal)
            for (const status of statuses) {
              const signature = `${status.power}|${status.updatedAt ?? ''}|${status.source}`
              if (lastStatusMap.get(status.deviceId) === signature) {
                continue
              }
              lastStatusMap.set(status.deviceId, signature)
              send({
                type: 'status',
                deviceId: status.deviceId,
                payload: {
                  power: status.power,
                  updatedAt: status.updatedAt,
                  source: status.source,
                },
                ts: Date.now(),
              })
            }
          })().catch(() => {
            // ignore polling error for stream stability
          })
        }, 4_000)
      }

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
        if (pollingTimer) {
          clearInterval(pollingTimer)
        }
        unsubscribe()
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

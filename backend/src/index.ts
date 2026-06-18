import { createApp } from './app'
import { MqttGatewayDurableObject } from './durable/mqtt-gateway-object'
import { runDueSchedules } from './lib/scheduler-runner'
import type { EnvBindings } from './types/app'

type WorkerExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void
}

const app = createApp()

export { createApp, MqttGatewayDurableObject }

const MQTT_GATEWAY_OBJECT_NAME = 'mqtt-gateway-singleton'

function looksLikeStaticAssetPath(pathname: string) {
  return /\.[^/]+$/.test(pathname)
}

async function serveWorkerAsset(request: Request, env: EnvBindings) {
  if (!env.ASSETS) {
    return null
  }

  const assetResponse = await env.ASSETS.fetch(request)
  if (assetResponse.status !== 404) {
    return assetResponse
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return assetResponse
  }

  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/') || looksLikeStaticAssetPath(url.pathname)) {
    return assetResponse
  }

  const indexUrl = new URL('/index.html', url)
  const indexRequest = new Request(indexUrl.toString(), request)
  return env.ASSETS.fetch(indexRequest)
}

export default {
  fetch: async (request: Request, env: EnvBindings, ctx: WorkerExecutionContext) => {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx as any)
    }

    const assetResponse = await serveWorkerAsset(request, env)
    if (assetResponse) {
      return assetResponse
    }

    return app.fetch(request, env, ctx as any)
  },
  scheduled: async (_event: unknown, env: EnvBindings, ctx: WorkerExecutionContext) => {
    ctx.waitUntil(
      runScheduledTick(env)
        .then((result) => {
          console.log('Scheduler tick completed', result)
        })
        .catch((error) => {
          console.error('Scheduler tick failed', error)
        }),
    )
  },
}

async function runScheduledTick(env: EnvBindings) {
  if (!env.MQTT_GATEWAY) {
    return runDueSchedules(env)
  }

  const objectId = env.MQTT_GATEWAY.idFromName(MQTT_GATEWAY_OBJECT_NAME)
  const objectStub = env.MQTT_GATEWAY.get(objectId)
  const response = await objectStub.fetch('https://mqtt-gateway.internal/scheduler/tick', {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Scheduler Durable Object tick failed (${response.status})`)
  }

  const payload = (await response.json()) as { data?: unknown }
  return payload.data ?? { processed: 0, failed: 0 }
}

import { RealtimeMqttProxy } from '../lib/realtime-mqtt-proxy'
import { createCommandEnvelope } from '../lib/commands'
import type { CommandAction, EnvBindings } from '../types/app'

type DurableObjectStateLike = {
  blockConcurrencyWhile?: <T>(callback: () => Promise<T>) => Promise<T>
}

function asAction(value: unknown): CommandAction | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toUpperCase()
  if (normalized === 'ON' || normalized === 'OFF') {
    return normalized
  }

  return null
}

function parsePublishRequestBody(input: unknown) {
  if (!input || typeof input !== 'object') {
    return null
  }

  const raw = input as Record<string, unknown>
  const deviceId = typeof raw.deviceId === 'string' ? raw.deviceId.trim() : ''
  const requestId = typeof raw.requestId === 'string' ? raw.requestId.trim() : ''
  const action = asAction(raw.action)
  const commandChannel = typeof raw.commandChannel === 'string' ? raw.commandChannel : undefined

  if (!deviceId || !requestId || !action) {
    return null
  }

  return createCommandEnvelope({
    deviceId,
    action,
    requestId,
    commandChannel,
  })
}

export class MqttGatewayDurableObject {
  private proxy: RealtimeMqttProxy | null = null
  private readonly startup: Promise<void>

  constructor(private readonly state: DurableObjectStateLike, private readonly env: EnvBindings) {
    const initialize = async () => {
      this.ensureProxy()
    }

    this.startup = this.state.blockConcurrencyWhile
      ? this.state.blockConcurrencyWhile(initialize)
      : initialize()
  }

  async fetch(request: Request) {
    await this.startup

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({
        ok: true,
      })
    }

    if (request.method !== 'POST' || url.pathname !== '/publish') {
      return Response.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Not found',
          },
        },
        { status: 404 },
      )
    }

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return Response.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid JSON payload',
          },
        },
        { status: 400 },
      )
    }

    const envelope = parsePublishRequestBody(payload)
    if (!envelope) {
      return Response.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'deviceId, action, and requestId are required',
          },
        },
        { status: 400 },
      )
    }

    try {
      await this.ensureProxy().publishCommand(envelope)
      return Response.json({
        success: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish command'
      return Response.json(
        {
          success: false,
          error: {
            code: 'MQTT_PUBLISH_FAILED',
            message,
          },
        },
        { status: 502 },
      )
    }
  }

  private ensureProxy() {
    if (this.proxy) {
      return this.proxy
    }

    const proxy = new RealtimeMqttProxy({
      url: this.env.MQTT_WS_URL,
      username: this.env.MQTT_USERNAME,
      password: this.env.MQTT_PASSWORD,
      clientIdPrefix: this.env.MQTT_CLIENT_ID_PREFIX ?? 'smartlamp-gateway',
      subscribeRealtime: false,
    })
    proxy.start()
    this.proxy = proxy
    return proxy
  }
}

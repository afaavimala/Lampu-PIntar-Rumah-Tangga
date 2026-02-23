import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishCommandPersistent } from '../src/lib/mqtt-command-dispatch'
import { publishCompatibleCommandOverWs } from '../src/lib/mqtt-command-publish'
import { getRealtimeMqttProxy } from '../src/lib/realtime-mqtt-proxy'

vi.mock('../src/lib/mqtt-command-publish', () => ({
  publishCompatibleCommandOverWs: vi.fn(async () => undefined),
}))

vi.mock('../src/lib/realtime-mqtt-proxy', () => ({
  getRealtimeMqttProxy: vi.fn(() => null),
}))

const envelope = {
  deviceId: 'lampu-uji',
  action: 'ON' as const,
  requestId: 'req-1',
  commandChannel: 'POWER',
}

describe('publishCommandPersistent', () => {
  beforeEach(() => {
    vi.mocked(publishCompatibleCommandOverWs).mockReset()
    vi.mocked(getRealtimeMqttProxy).mockReset()
    vi.mocked(getRealtimeMqttProxy).mockReturnValue(null as any)
  })

  it('uses durable object gateway when binding exists', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ success: true }))
    const namespace = {
      idFromName: vi.fn(() => 'mqtt-gateway-id'),
      get: vi.fn(() => ({
        fetch: fetchSpy,
      })),
    }

    await publishCommandPersistent(
      {
        MQTT_GATEWAY: namespace,
        MQTT_WS_URL: 'wss://broker.example/mqtt',
        JWT_SECRET: 'secret',
      } as any,
      envelope,
    )

    expect(namespace.idFromName).toHaveBeenCalledWith('mqtt-gateway-singleton')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishCompatibleCommandOverWs)).not.toHaveBeenCalled()
  })

  it('falls back to realtime proxy in local runtime when durable object binding is absent', async () => {
    const publishSpy = vi.fn(async () => undefined)
    vi.mocked(getRealtimeMqttProxy).mockReturnValue({
      publishCommand: publishSpy,
    } as any)

    await publishCommandPersistent(
      {
        MQTT_WS_URL: 'wss://broker.example/mqtt',
        JWT_SECRET: 'secret',
      } as any,
      envelope,
    )

    expect(publishSpy).toHaveBeenCalledWith(envelope)
    expect(vi.mocked(publishCompatibleCommandOverWs)).not.toHaveBeenCalled()
  })

  it('uses ws one-shot publish as last fallback', async () => {
    vi.mocked(getRealtimeMqttProxy).mockReturnValue(null as any)
    vi.mocked(publishCompatibleCommandOverWs).mockResolvedValue(undefined)

    await publishCommandPersistent(
      {
        MQTT_WS_URL: 'wss://broker.example/mqtt',
        MQTT_USERNAME: 'u',
        MQTT_PASSWORD: 'p',
        MQTT_CLIENT_ID_PREFIX: 'smartlamp',
        JWT_SECRET: 'secret',
      } as any,
      envelope,
    )

    expect(vi.mocked(publishCompatibleCommandOverWs)).toHaveBeenCalledTimes(1)
  })

  it('propagates durable object publish error details', async () => {
    const namespace = {
      idFromName: vi.fn(() => 'mqtt-gateway-id'),
      get: vi.fn(() => ({
        fetch: vi.fn(async () =>
          Response.json(
            {
              success: false,
              error: {
                code: 'MQTT_PUBLISH_FAILED',
                message: 'Broker rejected publish',
              },
            },
            { status: 502 },
          )),
      })),
    }

    await expect(
      publishCommandPersistent(
        {
          MQTT_GATEWAY: namespace,
          MQTT_WS_URL: 'wss://broker.example/mqtt',
          JWT_SECRET: 'secret',
        } as any,
        envelope,
      ),
    ).rejects.toThrow('Broker rejected publish')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandDispatchEnvelope } from '../src/lib/commands'
import { publishCompatibleCommandOverWs } from '../src/lib/mqtt-command-publish'
import { publishMqttOverWs } from '../src/lib/mqtt-ws'

vi.mock('../src/lib/mqtt-ws', () => ({
  publishMqttOverWs: vi.fn(async () => undefined),
}))

const envelope: CommandDispatchEnvelope = {
  deviceId: 'lampu-teras',
  action: 'ON',
  requestId: 'req-1',
}

describe('publishCompatibleCommandOverWs', () => {
  beforeEach(() => {
    vi.mocked(publishMqttOverWs).mockReset()
  })

  it('publishes command to tasmota topic variants', async () => {
    vi.mocked(publishMqttOverWs).mockResolvedValue(undefined)

    await publishCompatibleCommandOverWs(
      {
        url: 'wss://broker.example/mqtt',
        username: 'u',
        password: 'p',
      },
      envelope,
    )

    const topics = vi.mocked(publishMqttOverWs).mock.calls.map((call) => call[0].topic)
    expect(topics).toEqual([
      'cmnd/lampu-teras/POWER',
      'lampu-teras/cmnd/POWER',
    ])
  })

  it('succeeds when at least one topic profile is accepted by broker', async () => {
    vi.mocked(publishMqttOverWs)
      .mockRejectedValueOnce(new Error('not authorized'))
      .mockResolvedValueOnce(undefined)

    await expect(
      publishCompatibleCommandOverWs(
        {
          url: 'wss://broker.example/mqtt',
        },
        envelope,
      ),
    ).resolves.toBeUndefined()
  })

  it('throws when all compatible publish targets fail', async () => {
    vi.mocked(publishMqttOverWs).mockRejectedValue(new Error('not authorized'))

    await expect(
      publishCompatibleCommandOverWs(
        {
          url: 'wss://broker.example/mqtt',
        },
        envelope,
      ),
    ).rejects.toThrow('Failed to publish command on all MQTT topic profiles')
  })
})

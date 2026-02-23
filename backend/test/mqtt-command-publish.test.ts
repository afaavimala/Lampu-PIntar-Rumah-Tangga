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
  commandChannel: 'POWER',
}

describe('publishCompatibleCommandOverWs', () => {
  beforeEach(() => {
    vi.mocked(publishMqttOverWs).mockReset()
  })

  it('publishes command to canonical tasmota topic', async () => {
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
    ])
  })

  it('throws when canonical publish fails', async () => {
    vi.mocked(publishMqttOverWs).mockRejectedValue(new Error('not authorized'))

    await expect(
      publishCompatibleCommandOverWs(
        {
          url: 'wss://broker.example/mqtt',
        },
        envelope,
      ),
    ).rejects.toThrow('Failed to publish MQTT command')
  })

  it('uses configured command channel when provided in envelope', async () => {
    vi.mocked(publishMqttOverWs).mockResolvedValue(undefined)

    await publishCompatibleCommandOverWs(
      {
        url: 'wss://broker.example/mqtt',
      },
      {
        ...envelope,
        commandChannel: 'POWER4',
      },
    )

    const topics = vi.mocked(publishMqttOverWs).mock.calls.map((call) => call[0].topic)
    expect(topics).toEqual(['cmnd/lampu-teras/POWER4'])
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildCommandPublishTargets,
  buildLwtSnapshotSubscribeTopics,
  extractLwtDeviceIdFromTopic,
  getRealtimeSubscribeTopics,
  parseRealtimeMqttMessage,
} from '../src/lib/mqtt-compat'

describe('mqtt compatibility helpers', () => {
  it('builds command topics for smartlamp and tasmota profiles', () => {
    const targets = buildCommandPublishTargets({
      deviceId: 'lampu-teras',
      action: 'ON',
      envelopeJson: '{"deviceId":"lampu-teras"}',
    })

    expect(targets.map((target) => target.topic)).toEqual([
      'home/lampu-teras/cmd',
      'cmnd/lampu-teras/POWER',
      'lampu-teras/cmnd/POWER',
    ])
    expect(targets.map((target) => target.payload)).toEqual([
      '{"deviceId":"lampu-teras"}',
      'ON',
      'ON',
    ])
  })

  it('parses smartlamp status and lwt topics', () => {
    const status = parseRealtimeMqttMessage(
      'home/lampu-ruang-tamu/status',
      '{"power":"ON","ts":1700000000000}',
    )
    const lwt = parseRealtimeMqttMessage('home/lampu-ruang-tamu/lwt', 'offline')

    expect(status).toEqual({
      type: 'status',
      deviceId: 'lampu-ruang-tamu',
      payload: { power: 'ON', ts: 1700000000000 },
    })
    expect(lwt).toEqual({
      type: 'lwt',
      deviceId: 'lampu-ruang-tamu',
      payload: 'OFFLINE',
    })
  })

  it('parses tasmota stat power and result/state payloads', () => {
    const statPower = parseRealtimeMqttMessage('stat/tasmota_123/POWER', 'ON')
    const statResult = parseRealtimeMqttMessage('tasmota_123/stat/RESULT', '{"POWER":"OFF"}')
    const teleState = parseRealtimeMqttMessage('tele/tasmota_123/STATE', '{"POWER1":"ON"}')

    expect(statPower).toEqual({
      type: 'status',
      deviceId: 'tasmota_123',
      payload: {
        power: 'ON',
        source: 'tasmota_stat_power',
      },
    })
    expect(statResult).toEqual({
      type: 'status',
      deviceId: 'tasmota_123',
      payload: {
        power: 'OFF',
        source: 'tasmota_stat_result',
        raw: { POWER: 'OFF' },
      },
    })
    expect(teleState).toEqual({
      type: 'status',
      deviceId: 'tasmota_123',
      payload: {
        power: 'ON',
        source: 'tasmota_tele_state',
        raw: { POWER1: 'ON' },
      },
    })
  })

  it('parses tasmota lwt in both fulltopic orders', () => {
    const left = parseRealtimeMqttMessage('tele/tasmota_abc/LWT', 'Online')
    const right = parseRealtimeMqttMessage('tasmota_abc/tele/LWT', 'Offline')

    expect(left).toEqual({
      type: 'lwt',
      deviceId: 'tasmota_abc',
      payload: 'ONLINE',
    })
    expect(right).toEqual({
      type: 'lwt',
      deviceId: 'tasmota_abc',
      payload: 'OFFLINE',
    })
  })

  it('builds and resolves lwt snapshot topics for both profiles', () => {
    const topics = buildLwtSnapshotSubscribeTopics(['lampu-1'])

    expect(topics).toEqual([
      'home/lampu-1/lwt',
      'tele/lampu-1/LWT',
      'lampu-1/tele/LWT',
    ])

    expect(extractLwtDeviceIdFromTopic('home/lampu-1/lwt')).toBe('lampu-1')
    expect(extractLwtDeviceIdFromTopic('tele/lampu-1/LWT')).toBe('lampu-1')
    expect(extractLwtDeviceIdFromTopic('lampu-1/tele/LWT')).toBe('lampu-1')
  })

  it('includes tasmota subscribe topics in realtime proxy filters', () => {
    const topics = getRealtimeSubscribeTopics()
    expect(topics).toContain('home/+/status')
    expect(topics).toContain('stat/+/POWER')
    expect(topics).toContain('stat/+/RESULT')
    expect(topics).toContain('tele/+/STATE')
    expect(topics).toContain('tele/+/LWT')
  })
})

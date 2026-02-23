import { describe, expect, it } from 'vitest'
import {
  buildCommandPublishTargets,
  buildLwtSnapshotSubscribeTopics,
  extractTasmotaCommandChannelsFromObject,
  extractTasmotaDeviceIdFromTopic,
  extractLwtDeviceIdFromTopic,
  getTasmotaDiscoverySubscribeTopics,
  getRealtimeSubscribeTopics,
  normalizeTasmotaSwitchValue,
  pickSuggestedTasmotaCommandChannel,
  parseTasmotaPowerPayload,
  parseRealtimeMqttMessage,
} from '../src/lib/mqtt-compat'

describe('mqtt compatibility helpers', () => {
  it('builds command topics for tasmota profiles', () => {
    const targets = buildCommandPublishTargets({
      deviceId: 'lampu-teras',
      action: 'ON',
    })

    expect(targets.map((target) => target.topic)).toEqual([
      'cmnd/lampu-teras/POWER',
    ])
    expect(targets.map((target) => target.payload)).toEqual(['ON'])
  })

  it('builds command topic using provided tasmota channel', () => {
    const targets = buildCommandPublishTargets({
      deviceId: 'lampu-teras',
      action: 'OFF',
      commandChannel: 'power2',
    })

    expect(targets.map((target) => target.topic)).toEqual([
      'cmnd/lampu-teras/POWER2',
    ])
    expect(targets.map((target) => target.payload)).toEqual(['OFF'])
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

  it('builds and resolves lwt snapshot topics for tasmota fulltopic variants', () => {
    const topics = buildLwtSnapshotSubscribeTopics(['lampu-1'])

    expect(topics).toEqual([
      'tele/lampu-1/LWT',
      'lampu-1/tele/LWT',
    ])

    expect(extractLwtDeviceIdFromTopic('tele/lampu-1/LWT')).toBe('lampu-1')
    expect(extractLwtDeviceIdFromTopic('lampu-1/tele/LWT')).toBe('lampu-1')
  })

  it('includes tasmota subscribe topics in realtime proxy filters', () => {
    const topics = getRealtimeSubscribeTopics()
    expect(topics).toContain('stat/+/POWER')
    expect(topics).toContain('stat/+/RESULT')
    expect(topics).toContain('tele/+/STATE')
    expect(topics).toContain('tele/+/LWT')
  })

  it('provides wildcard topics for tasmota discovery scan', () => {
    const topics = getTasmotaDiscoverySubscribeTopics()
    expect(topics).toContain('tele/+/LWT')
    expect(topics).toContain('+/tele/LWT')
    expect(topics).toContain('tele/+/STATE')
    expect(topics).toContain('+/tele/STATE')
    expect(topics).toContain('stat/+/RESULT')
    expect(topics).toContain('+/stat/RESULT')
    expect(topics).toContain('stat/+/STATUS')
    expect(topics).toContain('+/stat/STATUS')
    expect(topics).toContain('stat/+/STATUS11')
    expect(topics).toContain('+/stat/STATUS11')
  })

  it('normalizes and parses tasmota power payload variants', () => {
    expect(normalizeTasmotaSwitchValue('ON')).toBe('ON')
    expect(normalizeTasmotaSwitchValue('0')).toBe('OFF')
    expect(normalizeTasmotaSwitchValue(1)).toBe('ON')
    expect(normalizeTasmotaSwitchValue(false)).toBe('OFF')

    expect(parseTasmotaPowerPayload('OFF')).toBe('OFF')
    expect(parseTasmotaPowerPayload('{"POWER1":"ON"}')).toBe('ON')
    expect(parseTasmotaPowerPayload('{"POWER":"OFF"}')).toBe('OFF')
    expect(parseTasmotaPowerPayload('{"Foo":"Bar"}')).toBeNull()
  })

  it('extracts device id from tasmota topic order variants', () => {
    expect(extractTasmotaDeviceIdFromTopic('stat/lamp-a/RESULT', 'stat')).toBe('lamp-a')
    expect(extractTasmotaDeviceIdFromTopic('lamp-a/stat/RESULT', 'stat')).toBe('lamp-a')
    expect(extractTasmotaDeviceIdFromTopic('tele/lamp-b/LWT', 'tele')).toBe('lamp-b')
    expect(extractTasmotaDeviceIdFromTopic('lamp-b/tele/LWT', 'tele')).toBe('lamp-b')
    expect(extractTasmotaDeviceIdFromTopic('invalid/topic', 'tele')).toBeNull()
  })

  it('extracts available power entities from status payloads', () => {
    expect(extractTasmotaCommandChannelsFromObject({ POWER: 'ON' })).toEqual(['POWER'])
    expect(extractTasmotaCommandChannelsFromObject({ POWER: '0000' })).toEqual([
      'POWER1',
      'POWER2',
      'POWER3',
      'POWER4',
    ])
    expect(extractTasmotaCommandChannelsFromObject({ POWER2: 'ON', POWER4: 'OFF' })).toEqual([
      'POWER2',
      'POWER4',
    ])
  })

  it('suggests first indexed channel for multi-channel tasmota devices', () => {
    expect(pickSuggestedTasmotaCommandChannel(['POWER'])).toBe('POWER')
    expect(pickSuggestedTasmotaCommandChannel(['POWER3', 'POWER1', 'POWER2'])).toBe('POWER1')
    expect(pickSuggestedTasmotaCommandChannel([])).toBe('POWER')
  })
})

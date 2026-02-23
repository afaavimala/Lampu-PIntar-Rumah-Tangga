import type { CommandAction } from '../types/app'

export type ParsedRealtimeMqttEvent =
  | {
      type: 'status'
      deviceId: string
      payload: Record<string, unknown>
    }
  | {
      type: 'lwt'
      deviceId: string
      payload: string
    }

export type CommandPublishTarget = {
  topic: string
  payload: string
}

export type NormalizedSwitchPower = 'ON' | 'OFF'

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

export function normalizeTasmotaSwitchValue(value: unknown): NormalizedSwitchPower | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    if (normalized === 'ON' || normalized === 'OFF') {
      return normalized
    }
    if (normalized === '1') {
      return 'ON'
    }
    if (normalized === '0') {
      return 'OFF'
    }
    return null
  }

  if (typeof value === 'number') {
    return value === 0 ? 'OFF' : 'ON'
  }

  if (typeof value === 'boolean') {
    return value ? 'ON' : 'OFF'
  }

  return null
}

export function extractTasmotaPowerFromObject(payload: Record<string, unknown>) {
  const directPower = normalizeTasmotaSwitchValue(payload.POWER)
  if (directPower) {
    return directPower
  }

  for (const [key, value] of Object.entries(payload)) {
    if (/^POWER\d+$/i.test(key)) {
      const normalized = normalizeTasmotaSwitchValue(value)
      if (normalized) {
        return normalized
      }
    }
  }

  return null
}

export function parseTasmotaPowerPayload(payload: string): NormalizedSwitchPower | null {
  const asSwitchText = normalizeTasmotaSwitchValue(payload)
  if (asSwitchText) {
    return asSwitchText
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }

  return extractTasmotaPowerFromObject(parsed)
}

function parseTasmotaJsonStatus(topic: string, payload: string, source: string): ParsedRealtimeMqttEvent | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }

  const power = extractTasmotaPowerFromObject(parsed)
  if (!power) {
    return null
  }

  const deviceId = extractDeviceIdFromTopic(topic, source.startsWith('tasmota_tele') ? 'tele' : 'stat')
  if (!deviceId) {
    return null
  }

  return {
    type: 'status',
    deviceId,
    payload: {
      power,
      source,
      raw: parsed,
    },
  }
}

function extractDeviceIdFromTopic(topic: string, expectedPrefix: 'stat' | 'tele') {
  const parts = topic.split('/')
  if (parts.length !== 3) {
    return null
  }

  const left = parts[0].toLowerCase()
  const middle = parts[1].toLowerCase()

  if (left === expectedPrefix) {
    return parts[1]
  }

  if (middle === expectedPrefix) {
    return parts[0]
  }

  return null
}

export function extractTasmotaDeviceIdFromTopic(topic: string, expectedPrefix: 'stat' | 'tele') {
  return extractDeviceIdFromTopic(topic, expectedPrefix)
}

export function buildCommandPublishTargets(input: {
  deviceId: string
  action: CommandAction
}): CommandPublishTarget[] {
  const deviceId = input.deviceId.trim()
  if (!deviceId) {
    return []
  }

  return [
    {
      topic: `cmnd/${deviceId}/POWER`,
      payload: input.action,
    },
    {
      topic: `${deviceId}/cmnd/POWER`,
      payload: input.action,
    },
  ]
}

export function getRealtimeSubscribeTopics() {
  const tasmotaPowerTopics = Array.from({ length: 8 }, (_, index) => {
    const suffix = index === 0 ? 'POWER' : `POWER${index + 1}`
    return [`stat/+/${suffix}`, `+/stat/${suffix}`]
  }).flat()

  return uniqueValues([
    ...tasmotaPowerTopics,
    'stat/+/RESULT',
    '+/stat/RESULT',
    'tele/+/STATE',
    '+/tele/STATE',
    'tele/+/LWT',
    '+/tele/LWT',
  ])
}

export function getTasmotaDiscoverySubscribeTopics() {
  return uniqueValues([
    'tele/+/LWT',
    '+/tele/LWT',
    'tele/+/STATE',
    '+/tele/STATE',
    'stat/+/RESULT',
    '+/stat/RESULT',
    'stat/+/POWER',
    '+/stat/POWER',
  ])
}

export function parseRealtimeMqttMessage(topic: string, payload: string): ParsedRealtimeMqttEvent | null {
  const parts = topic.split('/')
  if (parts.length !== 3) {
    return null
  }

  const suffix = parts[2].toLowerCase()
  const left = parts[0].toLowerCase()
  const middle = parts[1].toLowerCase()

  if ((left === 'stat' || middle === 'stat') && /^power\d*$/i.test(parts[2])) {
    const deviceId = extractDeviceIdFromTopic(topic, 'stat')
    if (!deviceId) {
      return null
    }

    const power = parseTasmotaPowerPayload(payload) ?? payload.trim().toUpperCase()
    if (!power) {
      return null
    }

    return {
      type: 'status',
      deviceId,
      payload: {
        power,
        source: 'tasmota_stat_power',
      },
    }
  }

  if ((left === 'stat' || middle === 'stat') && suffix === 'result') {
    return parseTasmotaJsonStatus(topic, payload, 'tasmota_stat_result')
  }

  if ((left === 'tele' || middle === 'tele') && suffix === 'state') {
    return parseTasmotaJsonStatus(topic, payload, 'tasmota_tele_state')
  }

  if ((left === 'tele' || middle === 'tele') && suffix === 'lwt') {
    const deviceId = extractDeviceIdFromTopic(topic, 'tele')
    if (!deviceId) {
      return null
    }

    return {
      type: 'lwt',
      deviceId,
      payload: payload.trim().toUpperCase(),
    }
  }

  return null
}

export function buildLwtSnapshotSubscribeTopics(deviceIds: string[]) {
  const cleanedDeviceIds = deviceIds.map((id) => id.trim()).filter(Boolean)
  const topics = cleanedDeviceIds.flatMap((deviceId) => [
    `tele/${deviceId}/LWT`,
    `${deviceId}/tele/LWT`,
  ])
  return uniqueValues(topics)
}

export function extractLwtDeviceIdFromTopic(topic: string) {
  const parts = topic.split('/')
  if (parts.length !== 3) {
    return null
  }

  const suffix = parts[2].toLowerCase()
  const left = parts[0].toLowerCase()
  const middle = parts[1].toLowerCase()
  if (suffix !== 'lwt') {
    return null
  }

  if (left === 'tele') {
    return parts[1]
  }

  if (middle === 'tele') {
    return parts[0]
  }

  return null
}

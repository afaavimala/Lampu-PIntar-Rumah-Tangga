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
  profile: 'smartlamp' | 'tasmota'
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function normalizeSwitchValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    return normalized || null
  }

  if (typeof value === 'number') {
    return value === 0 ? 'OFF' : 'ON'
  }

  if (typeof value === 'boolean') {
    return value ? 'ON' : 'OFF'
  }

  return null
}

function extractPowerFromObject(payload: Record<string, unknown>) {
  const directPower = normalizeSwitchValue(payload.POWER)
  if (directPower) {
    return directPower
  }

  for (const [key, value] of Object.entries(payload)) {
    if (/^POWER\d+$/i.test(key)) {
      const normalized = normalizeSwitchValue(value)
      if (normalized) {
        return normalized
      }
    }
  }

  return null
}

function parseHomeStatusPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    return parsed
  } catch {
    return { raw: payload }
  }
}

function parseTasmotaJsonStatus(topic: string, payload: string, source: string): ParsedRealtimeMqttEvent | null {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }

  const power = extractPowerFromObject(parsed)
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

function extractDeviceIdFromTopic(topic: string, expectedPrefix: 'home' | 'stat' | 'tele') {
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

export function buildCommandPublishTargets(input: {
  deviceId: string
  action: CommandAction
  envelopeJson: string
}): CommandPublishTarget[] {
  const deviceId = input.deviceId.trim()
  if (!deviceId) {
    return []
  }

  return [
    {
      topic: `home/${deviceId}/cmd`,
      payload: input.envelopeJson,
      profile: 'smartlamp',
    },
    {
      topic: `cmnd/${deviceId}/POWER`,
      payload: input.action,
      profile: 'tasmota',
    },
    {
      topic: `${deviceId}/cmnd/POWER`,
      payload: input.action,
      profile: 'tasmota',
    },
  ]
}

export function getRealtimeSubscribeTopics() {
  const tasmotaPowerTopics = Array.from({ length: 8 }, (_, index) => {
    const suffix = index === 0 ? 'POWER' : `POWER${index + 1}`
    return [`stat/+/${suffix}`, `+/stat/${suffix}`]
  }).flat()

  return uniqueValues([
    'home/+/status',
    'home/+/lwt',
    ...tasmotaPowerTopics,
    'stat/+/RESULT',
    '+/stat/RESULT',
    'tele/+/STATE',
    '+/tele/STATE',
    'tele/+/LWT',
    '+/tele/LWT',
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

  if (left === 'home' && suffix === 'status') {
    return {
      type: 'status',
      deviceId: parts[1],
      payload: parseHomeStatusPayload(payload),
    }
  }

  if (left === 'home' && suffix === 'lwt') {
    return {
      type: 'lwt',
      deviceId: parts[1],
      payload: payload.trim().toUpperCase(),
    }
  }

  if ((left === 'stat' || middle === 'stat') && /^power\d*$/i.test(parts[2])) {
    const deviceId = extractDeviceIdFromTopic(topic, 'stat')
    if (!deviceId) {
      return null
    }

    const power = normalizeSwitchValue(payload) ?? payload.trim()
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
    `home/${deviceId}/lwt`,
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

  if (left === 'home' || left === 'tele') {
    return parts[1]
  }

  if (middle === 'tele') {
    return parts[0]
  }

  return null
}

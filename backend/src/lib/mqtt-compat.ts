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
export type TasmotaPowerStateMap = Record<string, NormalizedSwitchPower>

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

const TASMOTA_COMMAND_CHANNEL_PATTERN = /^POWER(?:[1-9]\d?)?$/i
const TASMOTA_ENTITY_ID_SEPARATOR = '__'

function normalizeTasmotaCommandChannelValue(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toUpperCase()
  if (!normalized || !TASMOTA_COMMAND_CHANNEL_PATTERN.test(normalized)) {
    return null
  }

  return normalized
}

function isIndexedTasmotaCommandChannel(channel: string) {
  return /^POWER([1-9]\d*)$/.test(channel)
}

export function sortTasmotaCommandChannels(channels: string[]) {
  return uniqueValues(
    channels
      .map((channel) => normalizeTasmotaCommandChannelValue(channel))
      .filter((channel): channel is string => !!channel),
  ).sort((left, right) => {
    const leftIsPower = left === 'POWER'
    const rightIsPower = right === 'POWER'
    if (leftIsPower && !rightIsPower) return -1
    if (!leftIsPower && rightIsPower) return 1

    const leftIndex = left.match(/^POWER([1-9]\d*)$/)
    const rightIndex = right.match(/^POWER([1-9]\d*)$/)
    if (leftIndex && rightIndex) {
      return Number(leftIndex[1]) - Number(rightIndex[1])
    }

    return left.localeCompare(right)
  })
}

export function normalizeTasmotaCommandChannel(value: unknown): string {
  return normalizeTasmotaCommandChannelValue(value) ?? 'POWER'
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

export function extractTasmotaPowerStatesFromObject(payload: Record<string, unknown>): TasmotaPowerStateMap {
  const powerStates: TasmotaPowerStateMap = {}

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.trim().toUpperCase()
    const normalizedChannel = normalizeTasmotaCommandChannelValue(normalizedKey)
    if (!normalizedChannel) {
      continue
    }

    if (normalizedChannel === 'POWER') {
      const normalizedSwitch = normalizeTasmotaSwitchValue(value)
      if (normalizedSwitch) {
        powerStates.POWER = normalizedSwitch
        continue
      }

      if (typeof value === 'string') {
        const compact = value.trim()
        if (/^[01]+$/.test(compact)) {
          if (compact.length <= 1) {
            powerStates.POWER = compact === '1' ? 'ON' : 'OFF'
          } else {
            for (let index = 0; index < compact.length; index += 1) {
              powerStates[`POWER${index + 1}`] = compact[index] === '1' ? 'ON' : 'OFF'
            }
          }
        }
      }
      continue
    }

    const normalizedSwitch = normalizeTasmotaSwitchValue(value)
    if (normalizedSwitch) {
      powerStates[normalizedChannel] = normalizedSwitch
    }
  }

  return Object.fromEntries(
    sortTasmotaCommandChannels(Object.keys(powerStates)).map((channel) => [channel, powerStates[channel]]),
  )
}

export function extractTasmotaPowerFromObject(payload: Record<string, unknown>) {
  const powerStates = extractTasmotaPowerStatesFromObject(payload)
  const channels = sortTasmotaCommandChannels(Object.keys(powerStates))
  for (const channel of channels) {
    const power = powerStates[channel]
    if (power) {
      return power
    }
  }
  return null
}

export function extractTasmotaCommandChannelsFromObject(payload: Record<string, unknown>) {
  return sortTasmotaCommandChannels(Object.keys(extractTasmotaPowerStatesFromObject(payload)))
}

export function pickSuggestedTasmotaCommandChannel(channels: string[]) {
  const normalized = sortTasmotaCommandChannels(channels)
  const indexed = normalized.filter((channel) => isIndexedTasmotaCommandChannel(channel))
  if (indexed.length > 0) {
    return indexed[0]
  }

  if (normalized.includes('POWER')) {
    return 'POWER'
  }

  return 'POWER'
}

export function buildTasmotaEntityDeviceId(mqttDeviceId: string, commandChannel?: string) {
  const normalizedMqttDeviceId = mqttDeviceId.trim()
  if (!normalizedMqttDeviceId) {
    return ''
  }

  const normalizedChannel = normalizeTasmotaCommandChannel(commandChannel)
  if (normalizedChannel === 'POWER') {
    return normalizedMqttDeviceId
  }

  return `${normalizedMqttDeviceId}${TASMOTA_ENTITY_ID_SEPARATOR}${normalizedChannel}`
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

  const powerStates = extractTasmotaPowerStatesFromObject(parsed)
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
      powerStates,
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
  commandChannel?: string
}): CommandPublishTarget[] {
  const deviceId = input.deviceId.trim()
  if (!deviceId) {
    return []
  }

  const commandChannel = normalizeTasmotaCommandChannel(input.commandChannel)

  return [
    {
      topic: `cmnd/${deviceId}/${commandChannel}`,
      payload: input.action,
    },
  ]
}

export function getRealtimeSubscribeTopics() {
  const tasmotaPowerTopics = Array.from({ length: 9 }, (_, index) => {
    const suffix = index === 0 ? 'POWER' : `POWER${index}`
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
  const tasmotaPowerTopics = Array.from({ length: 9 }, (_, index) => {
    const suffix = index === 0 ? 'POWER' : `POWER${index}`
    return [`stat/+/${suffix}`, `+/stat/${suffix}`]
  }).flat()

  return uniqueValues([
    ...tasmotaPowerTopics,
    'tele/+/LWT',
    '+/tele/LWT',
    'tele/+/STATE',
    '+/tele/STATE',
    'stat/+/RESULT',
    '+/stat/RESULT',
    'stat/+/STATUS',
    '+/stat/STATUS',
    'stat/+/STATUS11',
    '+/stat/STATUS11',
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

    let parsedPayload: Record<string, unknown> | null = null
    try {
      parsedPayload = JSON.parse(payload) as Record<string, unknown>
    } catch {
      parsedPayload = null
    }

    const powerStates =
      parsedPayload && Object.keys(parsedPayload).length > 0
        ? extractTasmotaPowerStatesFromObject(parsedPayload)
        : (() => {
            const normalizedPower = parseTasmotaPowerPayload(payload)
            const normalizedChannel = normalizeTasmotaCommandChannel(parts[2])
            if (!normalizedPower) {
              return {}
            }
            return { [normalizedChannel]: normalizedPower }
          })()

    const power = parseTasmotaPowerPayload(payload) ?? payload.trim().toUpperCase()
    if (!power) {
      return null
    }

    return {
      type: 'status',
      deviceId,
      payload: {
        power,
        powerStates,
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

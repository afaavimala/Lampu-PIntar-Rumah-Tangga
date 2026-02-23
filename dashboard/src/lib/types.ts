export type CommandAction = 'ON' | 'OFF'

export type ApiEnvelope<T> = {
  success: boolean
  data: T
  error: null | {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  meta: {
    requestId: string
    timestamp: string
    version: string
  }
}

export type Device = {
  id: string
  name: string
  location: string | null
  commandChannel: string
}

export type DiscoveredDevice = {
  deviceId: string
  online: boolean | null
  power: 'ON' | 'OFF' | 'UNKNOWN'
  availableCommandChannels: string[]
  suggestedCommandChannel: string
  tasmotaTopic: string | null
  sources: string[]
  lastSeenAt: string
  suggestedName: string
  alreadyLinked: boolean
  alreadyRegistered: boolean
}

export type DiscoveryResult = {
  scannedAt: string
  waitMs: number
  maxDevices: number
  devices: DiscoveredDevice[]
}

export type BootstrapResponse = {
  devices: Device[]
  viewer:
    | {
        kind: 'user'
        id: number
        email: string
      }
    | {
        kind: 'client'
        id: number
        name: string
      }
    | null
  realtime:
    | {
        mode: 'proxy_sse'
        streamPath: string
      }
    | null
}

export type CommandDispatch = {
  deviceId: string
  action: CommandAction
  requestId: string
}

export type DeviceStatus = {
  deviceId: string
  power: string
  updatedAt: string | null
  source: string
}

export type ScheduleRule = {
  id: number
  userId: number
  deviceId: string
  action: CommandAction
  cron: string
  timezone: string
  enabled: boolean
  nextRunAt: number
  lastRunAt: number | null
  startAt: number | null
  endAt: number | null
  windowGroupId: string | null
  windowStartMinute: number | null
  windowEndMinute: number | null
  enforceEveryMinute: number | null
  createdAt: string
  updatedAt: string
}

export type ScheduleRun = {
  id: number
  scheduleId: number
  plannedAt: number
  executedAt: number | null
  requestId: string | null
  status: string
  reason: string | null
  createdAt: string
}

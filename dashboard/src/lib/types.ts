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
}

export type BootstrapResponse = {
  devices: Device[]
  realtime?: {
    mode: 'proxy_sse'
    streamPath: string
  }
}

export type CommandEnvelope = {
  deviceId: string
  action: CommandAction
  requestId: string
  issuedAt: number
  expiresAt: number
  nonce: string
  sig: string
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

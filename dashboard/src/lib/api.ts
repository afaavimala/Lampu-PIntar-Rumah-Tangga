import type {
  ApiEnvelope,
  BootstrapResponse,
  CommandDispatch,
  CommandAction,
  DiscoveryResult,
  DeviceStatus,
  ScheduleRule,
  ScheduleRun,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

type SchedulePatchInput = Partial<{
  action: CommandAction
  cron: string
  timezone: string
  enabled: boolean
  startAt: string | null
  endAt: string | null
  windowGroupId: string | null
  windowStartMinute: number | null
  windowEndMinute: number | null
  enforceEveryMinute: number | null
}>

async function safeParseEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  try {
    return (await response.json()) as ApiEnvelope<T>
  } catch {
    return null
  }
}

async function refreshSessionIfNeeded() {
  const refreshResponse = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })

  const refreshPayload = await safeParseEnvelope<{ refreshed: boolean }>(refreshResponse)
  return !!(refreshResponse.ok && refreshPayload?.success)
}

async function apiFetch<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.headers ?? {}),
    },
  })

  const payload = await safeParseEnvelope<T>(response)
  if (
    response.status === 401 &&
    allowRefresh &&
    path !== '/api/v1/auth/login' &&
    path !== '/api/v1/auth/refresh'
  ) {
    const refreshed = await refreshSessionIfNeeded()
    if (refreshed) {
      return apiFetch<T>(path, init, false)
    }
    if (!payload) {
      throw new Error('Session expired')
    }
  }

  if (!response.ok || !payload?.success) {
    const requestId = response.headers.get('x-request-id')
    const retryAfter = response.headers.get('retry-after')
    let message = payload?.error?.message ?? `Request failed (${response.status})`
    if (response.status === 429 && retryAfter) {
      message = `${message}. Retry after ${retryAfter}s`
    }
    if (requestId) {
      message = `${message} [requestId=${requestId}]`
    }
    throw new Error(message)
  }

  return payload.data
}

function jsonHeaders(idempotencyKey?: string) {
  return {
    'Content-Type': 'application/json',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  }
}

export function login(email: string, password: string) {
  return apiFetch<{ user: { id: number; email: string } }>('/api/v1/auth/login', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password }),
  })
}

export function logout() {
  return apiFetch<{ loggedOut: boolean }>('/api/v1/auth/logout', {
    method: 'POST',
    headers: jsonHeaders(),
  })
}

export function bootstrap() {
  return apiFetch<BootstrapResponse>('/api/v1/bootstrap')
}

export function createDevice(input: {
  deviceId: string
  name: string
  location?: string
  idempotencyKey: string
}) {
  return apiFetch<{ id: string; name: string; location: string | null }>('/api/v1/devices', {
    method: 'POST',
    headers: jsonHeaders(input.idempotencyKey),
    body: JSON.stringify({
      deviceId: input.deviceId,
      name: input.name,
      location: input.location,
    }),
  })
}

export function discoverDevices(input?: { waitMs?: number; maxDevices?: number }) {
  const params = new URLSearchParams()
  if (typeof input?.waitMs === 'number' && Number.isFinite(input.waitMs)) {
    params.set('waitMs', String(Math.floor(input.waitMs)))
  }
  if (typeof input?.maxDevices === 'number' && Number.isFinite(input.maxDevices)) {
    params.set('maxDevices', String(Math.floor(input.maxDevices)))
  }

  const suffix = params.toString()
  const path = suffix ? `/api/v1/devices/discovery?${suffix}` : '/api/v1/devices/discovery'
  return apiFetch<DiscoveryResult>(path)
}

export function executeCommand(input: {
  deviceId: string
  action: CommandAction
  requestId: string
  idempotencyKey: string
}) {
  return apiFetch<CommandDispatch>('/api/v1/commands/execute', {
    method: 'POST',
    headers: jsonHeaders(input.idempotencyKey),
    body: JSON.stringify({
      deviceId: input.deviceId,
      action: input.action,
      requestId: input.requestId,
    }),
  })
}

export function getFallbackStatus() {
  return apiFetch<DeviceStatus[]>('/api/v1/status')
}

export function listSchedules() {
  return apiFetch<ScheduleRule[]>('/api/v1/schedules')
}

export function createSchedule(input: {
  deviceId: string
  action: CommandAction
  cron: string
  timezone: string
  enabled: boolean
  startAt?: string
  endAt?: string
  windowGroupId?: string
  windowStartMinute?: number
  windowEndMinute?: number
  enforceEveryMinute?: number
  idempotencyKey: string
}) {
  return apiFetch<ScheduleRule>('/api/v1/schedules', {
    method: 'POST',
    headers: jsonHeaders(input.idempotencyKey),
    body: JSON.stringify({
      deviceId: input.deviceId,
      action: input.action,
      cron: input.cron,
      timezone: input.timezone,
      enabled: input.enabled,
      startAt: input.startAt,
      endAt: input.endAt,
      windowGroupId: input.windowGroupId,
      windowStartMinute: input.windowStartMinute,
      windowEndMinute: input.windowEndMinute,
      enforceEveryMinute: input.enforceEveryMinute,
    }),
  })
}

export function patchSchedule(
  scheduleId: number,
  patch: SchedulePatchInput,
  idempotencyKey: string,
) {
  return apiFetch<ScheduleRule>(`/api/v1/schedules/${scheduleId}`, {
    method: 'PATCH',
    headers: jsonHeaders(idempotencyKey),
    body: JSON.stringify(patch),
  })
}

export function deleteSchedule(scheduleId: number, idempotencyKey: string) {
  return apiFetch<{ deleted: boolean; scheduleId: number }>(`/api/v1/schedules/${scheduleId}`, {
    method: 'DELETE',
    headers: jsonHeaders(idempotencyKey),
  })
}

export function listScheduleRuns(scheduleId: number) {
  return apiFetch<ScheduleRun[]>(`/api/v1/schedules/${scheduleId}/runs`)
}

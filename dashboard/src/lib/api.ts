import type {
  ApiEnvelope,
  BootstrapResponse,
  CommandEnvelope,
  CommandAction,
  DeviceStatus,
  ScheduleRule,
  ScheduleRun,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

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

  let payload = await safeParseEnvelope<T>(response)
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
    const message = payload?.error?.message ?? `Request failed (${response.status})`
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

export function signCommand(input: {
  deviceId: string
  action: CommandAction
  requestId: string
  idempotencyKey: string
}) {
  return apiFetch<CommandEnvelope>('/api/v1/commands/sign', {
    method: 'POST',
    headers: jsonHeaders(input.idempotencyKey),
    body: JSON.stringify({
      deviceId: input.deviceId,
      action: input.action,
      requestId: input.requestId,
    }),
  })
}

export function executeCommand(input: {
  deviceId: string
  action: CommandAction
  requestId: string
  idempotencyKey: string
}) {
  return apiFetch<CommandEnvelope>('/api/v1/commands/execute', {
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
    }),
  })
}

export function patchSchedule(
  scheduleId: number,
  patch: Partial<Pick<ScheduleRule, 'action' | 'cron' | 'timezone' | 'enabled'>>,
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

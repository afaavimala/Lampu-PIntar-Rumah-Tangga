import type { Context } from 'hono'
import type { ApiErrorCode, AppEnv } from '../types/app'

type Meta = {
  requestId: string
  timestamp: string
  version: 'v1'
}

function getMeta(c: Context<AppEnv>): Meta {
  return {
    requestId: c.get('requestId') ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    version: 'v1',
  }
}

export function buildSuccessEnvelope<T>(c: Context<AppEnv>, data: T) {
  return {
    success: true,
    data,
    error: null,
    meta: getMeta(c),
  }
}

export function buildErrorEnvelope(
  c: Context<AppEnv>,
  code: ApiErrorCode,
  message: string,
  details: Record<string, unknown> = {},
) {
  return {
    success: false,
    data: null,
    error: {
      code,
      message,
      details,
    },
    meta: getMeta(c),
  }
}

export function ok<T>(c: Context<AppEnv>, data: T, status = 200) {
  return c.json(buildSuccessEnvelope(c, data), status as any)
}

export function fail(
  c: Context<AppEnv>,
  code: ApiErrorCode,
  message: string,
  status = 400,
  details: Record<string, unknown> = {},
) {
  return c.json(buildErrorEnvelope(c, code, message, details), status as any)
}

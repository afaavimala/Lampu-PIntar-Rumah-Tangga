import type { Context } from 'hono'
import type { AppEnv } from '../types/app'
import { sha256Hex } from './crypto'

type ExistingRecord = {
  idempotency_key: string
  route: string
  request_hash: string
  response_body: string
  status_code: number
}

export type IdempotencyState =
  | {
      kind: 'error'
      code: 'MISSING_KEY' | 'HASH_MISMATCH'
    }
  | {
      kind: 'replay'
      statusCode: number
      payload: unknown
    }
  | {
      kind: 'new'
      key: string
      requestHash: string
      route: string
    }

export async function beginIdempotentRequest(
  c: Context<AppEnv>,
  route: string,
  requestBodyRaw: string,
): Promise<IdempotencyState> {
  const key = c.req.header('idempotency-key')?.trim()
  if (!key) {
    return { kind: 'error', code: 'MISSING_KEY' }
  }

  const requestHash = await sha256Hex(`${c.req.method}|${route}|${requestBodyRaw}`)

  const existing = await c.env.DB
    .prepare(
      'SELECT idempotency_key, route, request_hash, response_body, status_code FROM idempotency_records WHERE idempotency_key = ? LIMIT 1',
    )
    .bind(key)
    .first<ExistingRecord>()

  if (!existing) {
    return {
      kind: 'new',
      key,
      requestHash,
      route,
    }
  }

  if (existing.request_hash !== requestHash || existing.route !== route) {
    return { kind: 'error', code: 'HASH_MISMATCH' }
  }

  return {
    kind: 'replay',
    statusCode: existing.status_code,
    payload: JSON.parse(existing.response_body),
  }
}

export async function persistIdempotentResponse(
  c: Context<AppEnv>,
  state: Extract<IdempotencyState, { kind: 'new' }>,
  statusCode: number,
  payload: unknown,
) {
  await c.env.DB
    .prepare(
      `INSERT INTO idempotency_records
       (idempotency_key, route, request_hash, response_body, status_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      state.key,
      state.route,
      state.requestHash,
      JSON.stringify(payload),
      statusCode,
      new Date().toISOString(),
    )
    .run()
}

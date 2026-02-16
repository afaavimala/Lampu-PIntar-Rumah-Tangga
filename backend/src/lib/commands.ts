import type { CommandAction } from '../types/app'
import { buildCommandSigningPayload, hmacSha256Hex } from './crypto'

export type SignedCommandEnvelope = {
  deviceId: string
  action: CommandAction
  requestId: string
  issuedAt: number
  expiresAt: number
  nonce: string
  sig: string
}

export async function createSignedEnvelope(input: {
  deviceId: string
  action: CommandAction
  requestId: string
  hmacSecret: string
  ttlMs?: number
}): Promise<SignedCommandEnvelope> {
  const issuedAt = Date.now()
  const expiresAt = issuedAt + (input.ttlMs ?? 30_000)
  const nonce = crypto.randomUUID()

  const payload = buildCommandSigningPayload({
    deviceId: input.deviceId,
    action: input.action,
    requestId: input.requestId,
    issuedAt,
    expiresAt,
    nonce,
  })

  const sig = await hmacSha256Hex(input.hmacSecret, payload)

  return {
    deviceId: input.deviceId,
    action: input.action,
    requestId: input.requestId,
    issuedAt,
    expiresAt,
    nonce,
    sig,
  }
}

export async function logCommandSignature(params: {
  db: D1Database
  userId: number | null
  deviceInternalId: number
  requestId: string
  action: CommandAction
  issuedAt: number
  expiresAt: number
  result: string
}) {
  await params.db
    .prepare(
      `INSERT INTO command_logs
       (request_id, user_id, device_id, action, issued_at, expires_at, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.requestId,
      params.userId,
      params.deviceInternalId,
      params.action,
      params.issuedAt,
      params.expiresAt,
      params.result,
      new Date().toISOString(),
    )
    .run()
}

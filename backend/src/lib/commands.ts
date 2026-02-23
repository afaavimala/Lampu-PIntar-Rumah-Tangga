import type { CommandAction } from '../types/app'

export type CommandDispatchEnvelope = {
  deviceId: string
  action: CommandAction
  requestId: string
}

export function createCommandEnvelope(input: {
  deviceId: string
  action: CommandAction
  requestId: string
}): CommandDispatchEnvelope {
  return {
    deviceId: input.deviceId.trim(),
    action: input.action,
    requestId: input.requestId,
  }
}

export async function logCommandDispatch(params: {
  db: D1Database
  userId: number | null
  deviceInternalId: number
  requestId: string
  action: CommandAction
  result: string
}) {
  const now = Date.now()

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
      now,
      now,
      params.result,
      new Date().toISOString(),
    )
    .run()
}

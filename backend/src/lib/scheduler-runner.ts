import { computeNextRunAt } from './schedules'
import { createSignedEnvelope, logCommandSignature } from './commands'
import { publishMqttOverWs } from './mqtt-ws'
import type { EnvBindings } from '../types/app'

type DueScheduleRow = {
  schedule_id: number
  user_id: number
  device_internal_id: number
  device_id: string
  action: 'ON' | 'OFF'
  cron_expr: string
  timezone: string
  next_run_at: number
  hmac_secret: string | null
}

export async function runDueSchedules(env: EnvBindings) {
  const now = Date.now()
  const dueRows = await env.DB
    .prepare(
      `SELECT ds.id AS schedule_id,
              ds.user_id,
              ds.device_id AS device_internal_id,
              d.device_id,
              ds.action,
              ds.cron_expr,
              ds.timezone,
              ds.next_run_at,
              d.hmac_secret
       FROM device_schedules ds
       INNER JOIN devices d ON d.id = ds.device_id
       WHERE ds.enabled = 1
         AND ds.next_run_at <= ?
         AND (ds.start_at IS NULL OR ds.start_at <= ?)
         AND (ds.end_at IS NULL OR ds.end_at >= ?)
       ORDER BY ds.next_run_at ASC
       LIMIT 50`,
    )
    .bind(now, now, now)
    .all<DueScheduleRow>()

  const rows = dueRows.results
  if (rows.length === 0) {
    return { processed: 0, failed: 0 }
  }

  let processed = 0
  let failed = 0
  const concurrency = 3

  for (let i = 0; i < rows.length; i += concurrency) {
    const chunk = rows.slice(i, i + concurrency)
    const chunkResults = await Promise.all(chunk.map((row) => handleOneSchedule(env, row)))
    for (const result of chunkResults) {
      if (result === 'failed') {
        failed += 1
      } else if (result === 'processed') {
        processed += 1
      }
    }
  }

  return { processed, failed }
}

async function handleOneSchedule(env: EnvBindings, row: DueScheduleRow): Promise<'processed' | 'failed' | 'skipped'> {
  const plannedAt = row.next_run_at

  const insertRun = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO schedule_runs
       (schedule_id, device_id, planned_at, status, created_at)
       VALUES (?, ?, ?, 'SKIPPED', ?)`,
    )
    .bind(row.schedule_id, row.device_internal_id, plannedAt, new Date().toISOString())
    .run()

  if ((insertRun.meta.changes ?? 0) === 0) {
    await advanceScheduleCursor(env, row, plannedAt, false)
    return 'skipped'
  }

  const requestId = `sch-${row.schedule_id}-${plannedAt}`
  try {
    const hmacSecret = row.hmac_secret ?? env.HMAC_GLOBAL_FALLBACK_SECRET
    if (!hmacSecret) {
      throw new Error('Missing HMAC secret for schedule command signing')
    }

    const envelope = await createSignedEnvelope({
      deviceId: row.device_id,
      action: row.action,
      requestId,
      hmacSecret,
    })

    await publishMqttOverWs({
      url: env.MQTT_WS_URL,
      username: env.MQTT_USERNAME,
      password: env.MQTT_PASSWORD,
      clientIdPrefix: env.MQTT_CLIENT_ID_PREFIX,
      topic: `home/${row.device_id}/cmd`,
      payload: JSON.stringify(envelope),
    })

    await env.DB
      .prepare(
        `UPDATE schedule_runs
         SET status = 'SUCCESS', executed_at = ?, request_id = ?, error_message = NULL
         WHERE schedule_id = ? AND planned_at = ?`,
      )
      .bind(Date.now(), requestId, row.schedule_id, plannedAt)
      .run()

    await logCommandSignature({
      db: env.DB,
      userId: row.user_id,
      deviceInternalId: row.device_internal_id,
      requestId,
      action: row.action,
      issuedAt: envelope.issuedAt,
      expiresAt: envelope.expiresAt,
      result: 'SCHEDULED_SUCCESS',
    })

    await advanceScheduleCursor(env, row, plannedAt, true)

    return 'processed'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown schedule failure'

    await env.DB
      .prepare(
        `UPDATE schedule_runs
         SET status = 'FAILED', executed_at = ?, request_id = ?, error_message = ?
         WHERE schedule_id = ? AND planned_at = ?`,
      )
      .bind(Date.now(), requestId, message, row.schedule_id, plannedAt)
      .run()

    await advanceScheduleCursor(env, row, plannedAt, true)

    return 'failed'
  }
}

async function advanceScheduleCursor(
  env: EnvBindings,
  row: DueScheduleRow,
  plannedAt: number,
  setLastRunAt: boolean,
) {
  const nextRunAt = computeNextRunAt({
    cron: row.cron_expr,
    timezone: row.timezone,
    fromDate: new Date(plannedAt + 1000),
  })

  const nowMs = Date.now()
  const nowIso = new Date().toISOString()

  if (setLastRunAt) {
    await env.DB
      .prepare(
        `UPDATE device_schedules
         SET last_run_at = ?, next_run_at = ?, updated_at = ?
         WHERE id = ? AND next_run_at <= ?`,
      )
      .bind(nowMs, nextRunAt, nowIso, row.schedule_id, plannedAt)
      .run()
    return
  }

  await env.DB
    .prepare(
      `UPDATE device_schedules
       SET next_run_at = ?, updated_at = ?
       WHERE id = ? AND next_run_at <= ?`,
    )
    .bind(nextRunAt, nowIso, row.schedule_id, plannedAt)
    .run()
}

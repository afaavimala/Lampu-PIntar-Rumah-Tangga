import { computeNextRunAt } from './schedules'
import { createCommandEnvelope, logCommandDispatch } from './commands'
import type { EnvBindings } from '../types/app'
import { publishCommandPersistent } from './mqtt-command-dispatch'
import { ensureDeviceCommandChannelCompatibility } from './db'

type DueScheduleRow = {
  schedule_id: number
  user_id: number
  device_internal_id: number
  device_id: string
  command_channel: string
  action: 'ON' | 'OFF'
  cron_expr: string
  timezone: string
  next_run_at: number
  window_group_id: string | null
  window_start_minute: number | null
  window_end_minute: number | null
  enforce_every_minute: number | null
}

function toLocalMinuteOfDay(epochMs: number, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(epochMs))
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '')
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '')
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null
    }
    return hour * 60 + minute
  } catch {
    return null
  }
}

function isWithinWindow(localMinute: number, startMinute: number, endMinute: number) {
  if (startMinute <= endMinute) {
    return localMinute >= startMinute && localMinute <= endMinute
  }
  return localMinute >= startMinute || localMinute <= endMinute
}

function shouldExecuteForWindow(row: DueScheduleRow, plannedAt: number) {
  if (
    row.window_start_minute == null ||
    row.window_end_minute == null ||
    row.enforce_every_minute == null
  ) {
    return true
  }

  const localMinute = toLocalMinuteOfDay(plannedAt, row.timezone)
  if (localMinute == null) {
    return true
  }

  const startMinute = Math.max(0, Math.min(1439, Number(row.window_start_minute)))
  const endMinute = Math.max(0, Math.min(1439, Number(row.window_end_minute)))
  const interval = Math.max(1, Math.min(1440, Number(row.enforce_every_minute)))

  if (!isWithinWindow(localMinute, startMinute, endMinute)) {
    return false
  }

  const elapsedSinceStart =
    localMinute >= startMinute ? localMinute - startMinute : 1440 - startMinute + localMinute
  return elapsedSinceStart % interval === 0
}

export async function runDueSchedules(env: EnvBindings) {
  await ensureDeviceCommandChannelCompatibility(env.DB)

  const now = Date.now()
  const dueRows = await env.DB
    .prepare(
      `SELECT ds.id AS schedule_id,
              ds.user_id,
              ds.device_id AS device_internal_id,
              d.device_id,
              COALESCE(NULLIF(TRIM(d.command_channel), ''), 'POWER') AS command_channel,
              ds.action,
              ds.cron_expr,
              ds.timezone,
              ds.next_run_at,
              ds.window_group_id,
              ds.window_start_minute,
              ds.window_end_minute,
              ds.enforce_every_minute
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

  if (!shouldExecuteForWindow(row, plannedAt)) {
    await advanceScheduleCursor(env, row, plannedAt, false)
    return 'skipped'
  }

  const insertSql = env.DB.dialect === 'mariadb'
    ? `INSERT IGNORE INTO schedule_runs
       (schedule_id, device_id, planned_at, status, created_at)
       VALUES (?, ?, ?, 'SKIPPED', ?)`
    : `INSERT OR IGNORE INTO schedule_runs
       (schedule_id, device_id, planned_at, status, created_at)
       VALUES (?, ?, ?, 'SKIPPED', ?)`

  const insertRun = await env.DB
    .prepare(insertSql)
    .bind(row.schedule_id, row.device_internal_id, plannedAt, new Date().toISOString())
    .run()

  if ((insertRun.meta.changes ?? 0) === 0) {
    await advanceScheduleCursor(env, row, plannedAt, false)
    return 'skipped'
  }

  const requestId = `sch-${row.schedule_id}-${plannedAt}`
  try {
    const envelope = createCommandEnvelope({
      deviceId: row.device_id,
      action: row.action,
      requestId,
      commandChannel: row.command_channel,
    })

    await publishCommandPersistent(env, envelope)

    await env.DB
      .prepare(
        `UPDATE schedule_runs
         SET status = 'SUCCESS', executed_at = ?, request_id = ?, error_message = NULL
         WHERE schedule_id = ? AND planned_at = ?`,
      )
      .bind(Date.now(), requestId, row.schedule_id, plannedAt)
      .run()

    await logCommandDispatch({
      db: env.DB,
      userId: row.user_id,
      deviceInternalId: row.device_internal_id,
      requestId,
      action: row.action,
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

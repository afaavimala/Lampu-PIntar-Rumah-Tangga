import { computeNextRunAt } from './schedules'
import { createCommandEnvelope, logCommandDispatch, type CommandDispatchEnvelope } from './commands'
import type { EnvBindings } from '../types/app'
import { publishCommandPersistent } from './mqtt-command-dispatch'
import { ensureDeviceCommandChannelCompatibility } from './db'

type DueScheduleRow = {
  schedule_id: number
  user_id: number
  device_internal_id: number
  device_id: string
  mqtt_device_id: string
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

type RunDueSchedulesOptions = {
  now?: number
  publishCommand?: (envelope: CommandDispatchEnvelope) => Promise<void>
}

function toLocalSecondOfDay(epochMs: number, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(epochMs))
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '')
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '')
    const second = Number(parts.find((part) => part.type === 'second')?.value ?? '')
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) {
      return null
    }
    return (hour % 24) * 3600 + minute * 60 + second
  } catch {
    return null
  }
}

function isWithinWindow(localSecond: number, startSecond: number, endSecond: number) {
  if (startSecond === endSecond) {
    return false
  }

  if (startSecond < endSecond) {
    return localSecond >= startSecond && localSecond < endSecond
  }

  return localSecond >= startSecond || localSecond < endSecond
}

function shouldExecuteForWindow(row: DueScheduleRow, plannedAt: number) {
  if (
    row.window_start_minute == null ||
    row.window_end_minute == null ||
    row.enforce_every_minute == null
  ) {
    return true
  }

  const localSecond = toLocalSecondOfDay(plannedAt, row.timezone)
  if (localSecond == null) {
    return true
  }

  const startSecond = Math.max(0, Math.min(86_399, Number(row.window_start_minute)))
  const endSecond = Math.max(0, Math.min(86_399, Number(row.window_end_minute)))
  const interval = Math.max(1, Math.min(86_400, Number(row.enforce_every_minute)))

  if (!isWithinWindow(localSecond, startSecond, endSecond)) {
    return false
  }

  const elapsedSinceStart =
    localSecond >= startSecond ? localSecond - startSecond : 86_400 - startSecond + localSecond
  return elapsedSinceStart % interval === 0
}

function hasWindowConfig(row: DueScheduleRow) {
  return (
    row.window_start_minute != null &&
    row.window_end_minute != null &&
    row.enforce_every_minute != null
  )
}

function normalizeCronForSchedule(row: DueScheduleRow) {
  const segments = row.cron_expr.trim().split(/\s+/)
  if (hasWindowConfig(row) && segments.length === 5) {
    return `* ${segments.join(' ')}`
  }
  return row.cron_expr
}

export async function runDueSchedules(env: EnvBindings, options: RunDueSchedulesOptions = {}) {
  await ensureDeviceCommandChannelCompatibility(env.DB)

  const now = options.now ?? Date.now()
  const publishCommand = options.publishCommand ?? ((envelope: CommandDispatchEnvelope) => publishCommandPersistent(env, envelope))
  const dueRows = await env.DB
    .prepare(
      `SELECT ds.id AS schedule_id,
              ds.user_id,
              ds.device_id AS device_internal_id,
              d.device_id,
              COALESCE(NULLIF(TRIM(d.mqtt_device_id), ''), d.device_id) AS mqtt_device_id,
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
    const chunkResults = await Promise.all(chunk.map((row) => handleOneSchedule(env, row, publishCommand)))
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

async function handleOneSchedule(
  env: EnvBindings,
  row: DueScheduleRow,
  publishCommand: (envelope: CommandDispatchEnvelope) => Promise<void>,
): Promise<'processed' | 'failed' | 'skipped'> {
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
      deviceId: row.mqtt_device_id,
      action: row.action,
      requestId,
      commandChannel: row.command_channel,
    })

    await publishCommand(envelope)

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
    cron: normalizeCronForSchedule(row),
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

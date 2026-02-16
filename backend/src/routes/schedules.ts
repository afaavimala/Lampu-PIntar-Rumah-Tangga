import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, CommandAction } from '../types/app'
import { parseJsonBody } from '../lib/body'
import { beginIdempotentRequest, persistIdempotentResponse } from '../lib/idempotency'
import { fail, buildSuccessEnvelope, ok } from '../lib/response'
import { requireAuth, requireUserAuth } from '../middleware/auth'
import { computeNextRunAt } from '../lib/schedules'
import { resolveDeviceAccess } from '../lib/db'

const createScheduleSchema = z.object({
  deviceId: z.string().min(1),
  action: z.enum(['ON', 'OFF']),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
})

const patchScheduleSchema = z.object({
  action: z.enum(['ON', 'OFF']).optional(),
  cron: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
})

export const scheduleRoutes = new Hono<AppEnv>()

scheduleRoutes.get('/', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  let query
  if (principal.kind === 'user') {
    query = await c.env.DB
      .prepare(
        `SELECT ds.id, ds.user_id, ds.device_id AS internal_device_id, ds.action, ds.cron_expr, ds.timezone,
                ds.enabled, ds.next_run_at, ds.last_run_at, ds.start_at, ds.end_at,
                ds.created_at, ds.updated_at, d.device_id
         FROM device_schedules ds
         INNER JOIN devices d ON d.id = ds.device_id
         WHERE ds.user_id = ?
         ORDER BY ds.id DESC`,
      )
      .bind(principal.userId)
      .all<Record<string, unknown>>()
  } else {
    query = await c.env.DB
      .prepare(
        `SELECT ds.id, ds.user_id, ds.device_id AS internal_device_id, ds.action, ds.cron_expr, ds.timezone,
                ds.enabled, ds.next_run_at, ds.last_run_at, ds.start_at, ds.end_at,
                ds.created_at, ds.updated_at, d.device_id
         FROM device_schedules ds
         INNER JOIN devices d ON d.id = ds.device_id
         ORDER BY ds.id DESC`,
      )
      .all<Record<string, unknown>>()
  }

  return ok(
    c,
    query.results.map((row) => toScheduleDto(row)),
  )
})

scheduleRoutes.get('/:scheduleId', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const scheduleId = Number(c.req.param('scheduleId'))
  if (Number.isNaN(scheduleId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid scheduleId', 400)
  }

  const schedule = await findScheduleById(c.env.DB, principal, scheduleId)
  if (!schedule) {
    return fail(c, 'SCHEDULE_NOT_FOUND', 'Schedule not found', 404)
  }

  return ok(c, toScheduleDto(schedule))
})

scheduleRoutes.post('/', requireUserAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'User authentication required', 401)
  }

  const parsed = await parseJsonBody(c, createScheduleSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const idempotency = await beginIdempotentRequest(c, '/api/v1/schedules:POST', parsed.raw)
  if (idempotency.kind === 'error') {
    return fail(c, 'IDEMPOTENCY_CONFLICT', 'Invalid idempotency request', 409, {
      reason: idempotency.code,
    })
  }
  if (idempotency.kind === 'replay') {
    return c.json(idempotency.payload, idempotency.statusCode as any)
  }

  const deviceAccess = await resolveDeviceAccess(c.env.DB, principal, parsed.data.deviceId)
  if (deviceAccess.access === 'not_found') {
    return fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404)
  }
  if (deviceAccess.access === 'forbidden') {
    return fail(c, 'FORBIDDEN_DEVICE_ACCESS', 'No access to this device', 403)
  }
  const device = deviceAccess.device
  if (!device) {
    return fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404)
  }

  let nextRunAt: number
  try {
    nextRunAt = computeNextRunAt({
      cron: parsed.data.cron,
      timezone: parsed.data.timezone,
      fromDate: parsed.data.startAt ? new Date(parsed.data.startAt) : new Date(),
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SCHEDULE_INVALID_CRON'
    return fail(
      c,
      code === 'SCHEDULE_INVALID_TIMEZONE' ? 'SCHEDULE_INVALID_TIMEZONE' : 'SCHEDULE_INVALID_CRON',
      'Schedule validation failed',
      400,
      { code },
    )
  }

  const nowIso = new Date().toISOString()
  const created = await c.env.DB
    .prepare(
      `INSERT INTO device_schedules
       (user_id, device_id, action, cron_expr, timezone, enabled, next_run_at, last_run_at, start_at, end_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .bind(
      principal.userId,
      device.id,
      parsed.data.action,
      parsed.data.cron,
      parsed.data.timezone,
      parsed.data.enabled ? 1 : 0,
      nextRunAt,
      parsed.data.startAt ? new Date(parsed.data.startAt).getTime() : null,
      parsed.data.endAt ? new Date(parsed.data.endAt).getTime() : null,
      nowIso,
      nowIso,
    )
    .run()

  const scheduleId = Number(created.meta.last_row_id)
  const schedule = await findScheduleById(c.env.DB, principal, scheduleId)
  if (!schedule) {
    return fail(c, 'INTERNAL_ERROR', 'Failed to create schedule', 500)
  }

  const payload = buildSuccessEnvelope(c, toScheduleDto(schedule))
  await persistIdempotentResponse(c, idempotency, 201, payload)
  return c.json(payload, 201)
})

scheduleRoutes.patch('/:scheduleId', requireUserAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'User authentication required', 401)
  }

  const scheduleId = Number(c.req.param('scheduleId'))
  if (Number.isNaN(scheduleId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid scheduleId', 400)
  }

  const parsed = await parseJsonBody(c, patchScheduleSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const idempotency = await beginIdempotentRequest(c, `/api/v1/schedules/${scheduleId}:PATCH`, parsed.raw)
  if (idempotency.kind === 'error') {
    return fail(c, 'IDEMPOTENCY_CONFLICT', 'Invalid idempotency request', 409, {
      reason: idempotency.code,
    })
  }
  if (idempotency.kind === 'replay') {
    return c.json(idempotency.payload, idempotency.statusCode as any)
  }

  const current = await findScheduleById(c.env.DB, principal, scheduleId)
  if (!current) {
    return fail(c, 'SCHEDULE_NOT_FOUND', 'Schedule not found', 404)
  }

  const action = (parsed.data.action ?? current.action) as CommandAction
  const cronExpr = parsed.data.cron ?? String(current.cron_expr)
  const timezone = parsed.data.timezone ?? String(current.timezone)

  let nextRunAt: number
  try {
    nextRunAt = computeNextRunAt({
      cron: cronExpr,
      timezone,
      fromDate: new Date(),
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SCHEDULE_INVALID_CRON'
    return fail(
      c,
      code === 'SCHEDULE_INVALID_TIMEZONE' ? 'SCHEDULE_INVALID_TIMEZONE' : 'SCHEDULE_INVALID_CRON',
      'Schedule validation failed',
      400,
      { code },
    )
  }

  const startAtValue =
    parsed.data.startAt === undefined
      ? current.start_at
      : parsed.data.startAt === null
        ? null
        : new Date(parsed.data.startAt).getTime()

  const endAtValue =
    parsed.data.endAt === undefined
      ? current.end_at
      : parsed.data.endAt === null
        ? null
        : new Date(parsed.data.endAt).getTime()

  await c.env.DB
    .prepare(
      `UPDATE device_schedules
       SET action = ?, cron_expr = ?, timezone = ?, enabled = ?, next_run_at = ?,
           start_at = ?, end_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      action,
      cronExpr,
      timezone,
      parsed.data.enabled === undefined ? current.enabled : parsed.data.enabled ? 1 : 0,
      nextRunAt,
      startAtValue,
      endAtValue,
      new Date().toISOString(),
      scheduleId,
      principal.userId,
    )
    .run()

  const updated = await findScheduleById(c.env.DB, principal, scheduleId)
  if (!updated) {
    return fail(c, 'SCHEDULE_NOT_FOUND', 'Schedule not found', 404)
  }

  const payload = buildSuccessEnvelope(c, toScheduleDto(updated))
  await persistIdempotentResponse(c, idempotency, 200, payload)
  return c.json(payload, 200)
})

scheduleRoutes.delete('/:scheduleId', requireUserAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'User authentication required', 401)
  }

  const scheduleId = Number(c.req.param('scheduleId'))
  if (Number.isNaN(scheduleId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid scheduleId', 400)
  }

  const idempotency = await beginIdempotentRequest(c, `/api/v1/schedules/${scheduleId}:DELETE`, '')
  if (idempotency.kind === 'error') {
    return fail(c, 'IDEMPOTENCY_CONFLICT', 'Invalid idempotency request', 409, {
      reason: idempotency.code,
    })
  }
  if (idempotency.kind === 'replay') {
    return c.json(idempotency.payload, idempotency.statusCode as any)
  }

  const deletion = await c.env.DB
    .prepare('DELETE FROM device_schedules WHERE id = ? AND user_id = ?')
    .bind(scheduleId, principal.userId)
    .run()

  if ((deletion.meta.changes ?? 0) === 0) {
    return fail(c, 'SCHEDULE_NOT_FOUND', 'Schedule not found', 404)
  }

  const payload = buildSuccessEnvelope(c, { deleted: true, scheduleId })
  await persistIdempotentResponse(c, idempotency, 200, payload)
  return c.json(payload, 200)
})

scheduleRoutes.get('/:scheduleId/runs', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const scheduleId = Number(c.req.param('scheduleId'))
  if (Number.isNaN(scheduleId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid scheduleId', 400)
  }

  const schedule = await findScheduleById(c.env.DB, principal, scheduleId)
  if (!schedule) {
    return fail(c, 'SCHEDULE_NOT_FOUND', 'Schedule not found', 404)
  }

  const runs = await c.env.DB
    .prepare(
      `SELECT id, schedule_id, planned_at, executed_at, request_id, status, error_message, created_at
       FROM schedule_runs
       WHERE schedule_id = ?
       ORDER BY planned_at DESC
       LIMIT 100`,
    )
    .bind(scheduleId)
    .all<Record<string, unknown>>()

  return ok(
    c,
    runs.results.map((row) => ({
      id: Number(row.id),
      scheduleId: Number(row.schedule_id),
      plannedAt: Number(row.planned_at),
      executedAt: row.executed_at == null ? null : Number(row.executed_at),
      requestId: row.request_id == null ? null : String(row.request_id),
      status: String(row.status),
      reason: row.error_message == null ? null : String(row.error_message),
      createdAt: String(row.created_at),
    })),
  )
})

async function findScheduleById(db: D1Database, principal: AppEnv['Variables']['principal'], scheduleId: number) {
  if (!principal) return null

  if (principal.kind === 'user') {
    return db
      .prepare(
        `SELECT ds.id, ds.user_id, ds.device_id AS internal_device_id, ds.action, ds.cron_expr, ds.timezone,
                ds.enabled, ds.next_run_at, ds.last_run_at, ds.start_at, ds.end_at,
                ds.created_at, ds.updated_at, d.device_id
         FROM device_schedules ds
         INNER JOIN devices d ON d.id = ds.device_id
         WHERE ds.id = ? AND ds.user_id = ?
         LIMIT 1`,
      )
      .bind(scheduleId, principal.userId)
      .first<Record<string, unknown>>()
  }

  return db
    .prepare(
      `SELECT ds.id, ds.user_id, ds.device_id AS internal_device_id, ds.action, ds.cron_expr, ds.timezone,
              ds.enabled, ds.next_run_at, ds.last_run_at, ds.start_at, ds.end_at,
              ds.created_at, ds.updated_at, d.device_id
       FROM device_schedules ds
       INNER JOIN devices d ON d.id = ds.device_id
       WHERE ds.id = ?
       LIMIT 1`,
    )
    .bind(scheduleId)
    .first<Record<string, unknown>>()
}

function toScheduleDto(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    deviceId: String(row.device_id),
    action: String(row.action),
    cron: String(row.cron_expr),
    timezone: String(row.timezone),
    enabled: Number(row.enabled) === 1,
    nextRunAt: Number(row.next_run_at),
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    startAt: row.start_at == null ? null : Number(row.start_at),
    endAt: row.end_at == null ? null : Number(row.end_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

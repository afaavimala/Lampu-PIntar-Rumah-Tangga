import type { Principal } from '../types/app'
import { listDevicesByPrincipal } from './db'

type LogRow = {
  action: string
  created_at: string
}

type ScheduleRunRow = {
  action: string
  created_at: string
}

export async function listBestStatus(db: D1Database, principal: Principal) {
  const devices = await listDevicesByPrincipal(db, principal)
  const statuses = []

  for (const device of devices) {
    const status = await getBestStatusForDevice(db, device.id, device.device_id)
    statuses.push(status)
  }

  return statuses
}

export async function getBestStatusForDevice(db: D1Database, internalId: number, publicId: string) {
  const latestCommand = await db
    .prepare(
      `SELECT action, created_at
       FROM command_logs
       WHERE device_id = ?
         AND result IN ('PUBLISHED', 'SCHEDULED_SUCCESS')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .bind(internalId)
    .first<LogRow>()

  const latestSchedule = await db
    .prepare(
      `SELECT ds.action, sr.created_at
       FROM schedule_runs sr
       INNER JOIN device_schedules ds ON ds.id = sr.schedule_id
       WHERE sr.device_id = ? AND sr.status = 'SUCCESS'
       ORDER BY sr.id DESC
       LIMIT 1`,
    )
    .bind(internalId)
    .first<ScheduleRunRow>()

  const candidates: Array<{ action: string; ts: string; source: 'command_logs' | 'schedule_runs' }> = []
  if (latestCommand) {
    candidates.push({ action: latestCommand.action, ts: latestCommand.created_at, source: 'command_logs' })
  }
  if (latestSchedule) {
    candidates.push({ action: latestSchedule.action, ts: latestSchedule.created_at, source: 'schedule_runs' })
  }

  candidates.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  const latest = candidates[0]

  return {
    deviceId: publicId,
    power: latest ? latest.action : 'UNKNOWN',
    updatedAt: latest ? latest.ts : null,
    source: latest ? latest.source : 'none',
  }
}

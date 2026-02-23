import type { Context } from 'hono'
import type { AppEnv, DeviceRecord, Principal } from '../types/app'

export type AuthSessionWithUser = {
  session_id: number
  user_id: number
  email: string
  refresh_token_hash: string
  expires_at: number
  created_at: string
  last_used_at: number | null
  rotated_at: number | null
  revoked_at: number | null
  replaced_by_session_id: number | null
}

const deviceSchemaCompatibilityByDb = new WeakMap<object, Promise<void>>()

function isDuplicateColumnError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('duplicate column') || message.includes('already exists')
}

export async function ensureDeviceCommandChannelCompatibility(db: D1Database) {
  const key = db as unknown as object
  const inFlight = deviceSchemaCompatibilityByDb.get(key)
  if (inFlight) {
    return inFlight
  }

  const compatibilityTask = (async () => {
    const dialect = (db as { dialect?: string }).dialect
    const addColumnSql =
      dialect === 'mariadb'
        ? `ALTER TABLE devices ADD COLUMN command_channel VARCHAR(32) NOT NULL DEFAULT 'POWER'`
        : `ALTER TABLE devices ADD COLUMN command_channel TEXT NOT NULL DEFAULT 'POWER'`

    try {
      await db.prepare(addColumnSql).run()
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }

    await db
      .prepare(
        `UPDATE devices
         SET command_channel = 'POWER'
         WHERE command_channel IS NULL OR TRIM(command_channel) = ''`,
      )
      .run()
  })().catch((error) => {
    deviceSchemaCompatibilityByDb.delete(key)
    throw error
  })

  deviceSchemaCompatibilityByDb.set(key, compatibilityTask)
  return compatibilityTask
}

export async function getUserByEmail(db: D1Database, email: string) {
  return db
    .prepare('SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<{ id: number; email: string; password_hash: string }>()
}

export async function getUserById(db: D1Database, id: number) {
  return db
    .prepare('SELECT id, email FROM users WHERE id = ? LIMIT 1')
    .bind(id)
    .first<{ id: number; email: string }>()
}

export async function updateUserPasswordHash(db: D1Database, userId: number, passwordHash: string) {
  return db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(passwordHash, userId)
    .run()
}

export async function createAuthSession(
  db: D1Database,
  input: {
    userId: number
    refreshTokenHash: string
    expiresAt: number
    userAgent: string | null
    ipAddress: string | null
  },
) {
  const nowIso = new Date().toISOString()
  const inserted = await db
    .prepare(
      `INSERT INTO auth_sessions
       (user_id, refresh_token_hash, expires_at, created_at, updated_at, last_used_at, rotated_at, revoked_at, replaced_by_session_id, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(
      input.userId,
      input.refreshTokenHash,
      input.expiresAt,
      nowIso,
      nowIso,
      input.userAgent,
      input.ipAddress,
    )
    .run()

  return Number(inserted.meta.last_row_id)
}

export async function findAuthSessionByRefreshTokenHash(db: D1Database, refreshTokenHash: string) {
  return db
    .prepare(
      `SELECT s.id AS session_id, s.user_id, u.email, s.refresh_token_hash, s.expires_at, s.created_at,
              s.last_used_at, s.rotated_at, s.revoked_at, s.replaced_by_session_id
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ?
       LIMIT 1`,
    )
    .bind(refreshTokenHash)
    .first<AuthSessionWithUser>()
}

export async function rotateAuthSession(
  db: D1Database,
  input: {
    previousSessionId: number
    replacementSessionId: number
    rotatedAt: number
  },
) {
  return db
    .prepare(
      `UPDATE auth_sessions
       SET rotated_at = ?, revoked_at = ?, replaced_by_session_id = ?, last_used_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.rotatedAt,
      input.rotatedAt,
      input.replacementSessionId,
      input.rotatedAt,
      new Date().toISOString(),
      input.previousSessionId,
    )
    .run()
}

export async function revokeAuthSessionByRefreshTokenHash(db: D1Database, refreshTokenHash: string) {
  const nowMs = Date.now()
  return db
    .prepare(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, ?), updated_at = ?
       WHERE refresh_token_hash = ?`,
    )
    .bind(nowMs, new Date().toISOString(), refreshTokenHash)
    .run()
}

export async function getApiClientByHash(db: D1Database, hash: string) {
  const row = await db
    .prepare('SELECT id, name, scopes, is_active FROM integration_clients WHERE api_key_hash = ? LIMIT 1')
    .bind(hash)
    .first<{ id: number; name: string; scopes: string; is_active: number }>()

  if (!row || row.is_active !== 1) {
    return null
  }

  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

export async function listDevicesByPrincipal(db: D1Database, principal: Principal) {
  await ensureDeviceCommandChannelCompatibility(db)

  if (principal.kind === 'user') {
    const result = await db
      .prepare(
        `SELECT d.id, d.device_id, d.name, d.location,
                COALESCE(NULLIF(TRIM(d.command_channel), ''), 'POWER') AS command_channel
         FROM devices d
         INNER JOIN user_devices ud ON ud.device_id = d.id
         WHERE ud.user_id = ?
         ORDER BY d.id ASC`,
      )
      .bind(principal.userId)
      .all<DeviceRecord>()
    return result.results
  }

  const result = await db
    .prepare(
      `SELECT id, device_id, name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel
       FROM devices
       ORDER BY id ASC`,
    )
    .all<DeviceRecord>()
  return result.results
}

export async function getDeviceByDeviceIdForPrincipal(
  db: D1Database,
  principal: Principal,
  deviceId: string,
) {
  await ensureDeviceCommandChannelCompatibility(db)

  if (principal.kind === 'user') {
    return db
      .prepare(
        `SELECT d.id, d.device_id, d.name, d.location,
                COALESCE(NULLIF(TRIM(d.command_channel), ''), 'POWER') AS command_channel
         FROM devices d
         INNER JOIN user_devices ud ON ud.device_id = d.id
         WHERE ud.user_id = ? AND d.device_id = ?
         LIMIT 1`,
      )
      .bind(principal.userId, deviceId)
      .first<DeviceRecord>()
  }

  return db
    .prepare(
      `SELECT id, device_id, name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel
       FROM devices
       WHERE device_id = ?
       LIMIT 1`,
    )
    .bind(deviceId)
    .first<DeviceRecord>()
}

export async function getDeviceByDeviceId(db: D1Database, deviceId: string) {
  await ensureDeviceCommandChannelCompatibility(db)

  return db
    .prepare(
      `SELECT id, device_id, name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel
       FROM devices
       WHERE device_id = ?
       LIMIT 1`,
    )
    .bind(deviceId)
    .first<DeviceRecord>()
}

export async function hasUserDeviceAccess(db: D1Database, userId: number, deviceInternalId: number) {
  const row = await db
    .prepare('SELECT 1 AS ok FROM user_devices WHERE user_id = ? AND device_id = ? LIMIT 1')
    .bind(userId, deviceInternalId)
    .first<{ ok: number }>()
  return !!row
}

export async function resolveDeviceAccess(
  db: D1Database,
  principal: Principal,
  deviceId: string,
): Promise<{
  device: DeviceRecord | null
  access: 'ok' | 'not_found' | 'forbidden'
}> {
  const device = await getDeviceByDeviceId(db, deviceId)
  if (!device) {
    return { device: null, access: 'not_found' }
  }

  if (principal.kind === 'client') {
    return { device, access: 'ok' }
  }

  const allowed = await hasUserDeviceAccess(db, principal.userId, device.id)
  if (!allowed) {
    return { device, access: 'forbidden' }
  }

  return { device, access: 'ok' }
}

export async function getDeviceByScheduleIdForPrincipal(
  db: D1Database,
  principal: Principal,
  scheduleId: number,
) {
  if (principal.kind === 'user') {
    return db
      .prepare(
        `SELECT ds.id AS schedule_id, ds.user_id, ds.device_id, ds.action, ds.cron_expr, ds.timezone,
                ds.enabled, ds.next_run_at, ds.last_run_at, ds.start_at, ds.end_at,
                d.device_id AS public_device_id, d.name, d.location
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
      `SELECT ds.id AS schedule_id, ds.user_id, ds.device_id, ds.action, ds.cron_expr, ds.timezone,
              ds.enabled, ds.next_run_at, ds.last_run_at, ds.start_at, ds.end_at,
              d.device_id AS public_device_id, d.name, d.location
       FROM device_schedules ds
       INNER JOIN devices d ON d.id = ds.device_id
       WHERE ds.id = ?
       LIMIT 1`,
    )
    .bind(scheduleId)
    .first<Record<string, unknown>>()
}

export function getDb(c: Context<AppEnv>) {
  return c.env.DB
}

import type { Context } from 'hono'
import type {
  AppEnv,
  DevicePermission,
  DeviceRecord,
  Principal,
  SchedulePermission,
  UserRole,
} from '../types/app'

export type AuthSessionWithUser = {
  session_id: number
  user_id: number
  name: string
  email: string
  role: UserRole
  is_active: number
  refresh_token_hash: string
  expires_at: number
  created_at: string
  last_used_at: number | null
  rotated_at: number | null
  revoked_at: number | null
  replaced_by_session_id: number | null
}

export type UserRecord = {
  id: number
  name: string
  email: string
  password_hash: string
  role: UserRole
  is_active: number
  created_at: string
  updated_at: string | null
}

export type UserSummaryRecord = Omit<UserRecord, 'password_hash'>

export type UserDeviceAssignmentRecord = {
  user_id: number
  device_id: number
  public_device_id: string
  name: string
  location: string | null
  command_channel: string
  device_permission: DevicePermission
  schedule_permission: SchedulePermission
  assigned_by_user_id: number | null
  created_at: string
  updated_at: string | null
}

const deviceSchemaCompatibilityByDb = new WeakMap<object, Promise<void>>()
const rbacSchemaCompatibilityByDb = new WeakMap<object, Promise<void>>()
const LEGACY_SEED_ADMIN_PASSWORD_HASHES = new Set([
  '$2b$12$pE5REBOZ19Ad.9CSB13J1O/n7nID3CKOq5dWd.XLOVlAHFLHEKTX.',
  '41e5653fc7aeb894026d6bb7b2db7f65902b454945fa8fd65a6327047b5277fb',
])

export function isLegacySeedAdminPasswordHash(passwordHash: string) {
  return LEGACY_SEED_ADMIN_PASSWORD_HASHES.has(passwordHash)
}

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
    const addCommandChannelColumnSql =
      dialect === 'mariadb'
        ? `ALTER TABLE devices ADD COLUMN command_channel VARCHAR(32) NOT NULL DEFAULT 'POWER'`
        : `ALTER TABLE devices ADD COLUMN command_channel TEXT NOT NULL DEFAULT 'POWER'`
    const addMqttDeviceIdColumnSql =
      dialect === 'mariadb'
        ? `ALTER TABLE devices ADD COLUMN mqtt_device_id VARCHAR(64) NOT NULL DEFAULT ''`
        : `ALTER TABLE devices ADD COLUMN mqtt_device_id TEXT NOT NULL DEFAULT ''`

    try {
      await db.prepare(addCommandChannelColumnSql).run()
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }

    try {
      await db.prepare(addMqttDeviceIdColumnSql).run()
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }

    await db
      .prepare(
        `UPDATE devices
         SET command_channel = COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER'),
             mqtt_device_id = COALESCE(NULLIF(TRIM(mqtt_device_id), ''), device_id)
         WHERE command_channel IS NULL OR TRIM(command_channel) = ''
            OR mqtt_device_id IS NULL OR TRIM(mqtt_device_id) = ''`,
      )
      .run()
  })().catch((error) => {
    deviceSchemaCompatibilityByDb.delete(key)
    throw error
  })

  deviceSchemaCompatibilityByDb.set(key, compatibilityTask)
  return compatibilityTask
}

async function tryAddColumn(db: D1Database, sql: string) {
  try {
    await db.prepare(sql).run()
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error
    }
  }
}

export async function ensureRbacCompatibility(db: D1Database, seedAdminEmail?: string) {
  const key = db as unknown as object
  const inFlight = rbacSchemaCompatibilityByDb.get(key)
  if (inFlight) {
    await inFlight
  } else {
    const compatibilityTask = (async () => {
      const dialect = (db as { dialect?: string }).dialect
      if (dialect === 'mariadb') {
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN name VARCHAR(255) NOT NULL DEFAULT ''`)
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'member'`)
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1`)
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN updated_at VARCHAR(64) NULL`)
        await tryAddColumn(
          db,
          `ALTER TABLE user_devices ADD COLUMN device_permission VARCHAR(32) NOT NULL DEFAULT 'monitoring'`,
        )
        await tryAddColumn(
          db,
          `ALTER TABLE user_devices ADD COLUMN schedule_permission VARCHAR(32) NOT NULL DEFAULT 'none'`,
        )
        await tryAddColumn(db, `ALTER TABLE user_devices ADD COLUMN assigned_by_user_id BIGINT UNSIGNED NULL`)
        await tryAddColumn(db, `ALTER TABLE user_devices ADD COLUMN updated_at VARCHAR(64) NULL`)
        await tryAddColumn(db, `ALTER TABLE device_schedules ADD COLUMN created_by_user_id BIGINT UNSIGNED NULL`)
      } else {
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''`)
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`)
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`)
        await tryAddColumn(db, `ALTER TABLE users ADD COLUMN updated_at TEXT`)
        await tryAddColumn(
          db,
          `ALTER TABLE user_devices ADD COLUMN device_permission TEXT NOT NULL DEFAULT 'monitoring'`,
        )
        await tryAddColumn(
          db,
          `ALTER TABLE user_devices ADD COLUMN schedule_permission TEXT NOT NULL DEFAULT 'none'`,
        )
        await tryAddColumn(db, `ALTER TABLE user_devices ADD COLUMN assigned_by_user_id INTEGER`)
        await tryAddColumn(db, `ALTER TABLE user_devices ADD COLUMN updated_at TEXT`)
        await tryAddColumn(db, `ALTER TABLE device_schedules ADD COLUMN created_by_user_id INTEGER`)
      }

      const nowIso = new Date().toISOString()
      await db
        .prepare(
          `UPDATE users
           SET name = CASE
                 WHEN lower(email) = lower(COALESCE(?, '')) THEN 'Administrator'
                 ELSE COALESCE(NULLIF(TRIM(name), ''), substr(email, 1, instr(email, '@') - 1))
               END,
               role = COALESCE(NULLIF(TRIM(role), ''), 'member'),
               is_active = COALESCE(is_active, 1),
               updated_at = COALESCE(updated_at, created_at, ?)
           WHERE name IS NULL OR TRIM(name) = ''
              OR role IS NULL OR TRIM(role) = ''
              OR is_active IS NULL
              OR updated_at IS NULL`,
        )
        .bind(seedAdminEmail?.trim() ?? 'admin@example.com', nowIso)
        .run()

      await db
        .prepare(
          `UPDATE user_devices
           SET device_permission = CASE
                 WHEN role = 'owner' THEN 'manage'
                 WHEN device_permission IN ('monitoring', 'control', 'manage') THEN device_permission
                 ELSE 'monitoring'
               END,
               schedule_permission = CASE
                 WHEN role = 'owner' THEN 'manage'
                 WHEN schedule_permission IN ('none', 'monitoring', 'manage') THEN schedule_permission
                 ELSE 'none'
               END,
               updated_at = COALESCE(updated_at, created_at, ?)
           WHERE device_permission IS NULL OR device_permission NOT IN ('monitoring', 'control', 'manage')
              OR schedule_permission IS NULL OR schedule_permission NOT IN ('none', 'monitoring', 'manage')
              OR updated_at IS NULL
              OR role = 'owner'`,
        )
        .bind(nowIso)
        .run()

      await db
        .prepare(
          `UPDATE device_schedules
           SET created_by_user_id = COALESCE(created_by_user_id, user_id)
           WHERE created_by_user_id IS NULL`,
        )
        .run()
    })().catch((error) => {
      rbacSchemaCompatibilityByDb.delete(key)
      throw error
    })

    rbacSchemaCompatibilityByDb.set(key, compatibilityTask)
    await compatibilityTask
  }

  const adminEmail = seedAdminEmail?.trim()
  if (adminEmail) {
    await db
      .prepare(
        `UPDATE users
         SET name = COALESCE(NULLIF(TRIM(name), ''), 'Administrator'),
             role = 'admin',
             is_active = 1,
             updated_at = ?
         WHERE lower(email) = lower(?)`,
      )
      .bind(new Date().toISOString(), adminEmail)
      .run()
  }
}

function normalizeUserRole(raw: string | null | undefined): UserRole {
  return raw === 'admin' ? 'admin' : 'member'
}

function normalizeDevicePermission(raw: string | null | undefined): DevicePermission {
  if (raw === 'manage' || raw === 'control' || raw === 'monitoring') {
    return raw
  }
  return 'monitoring'
}

function normalizeSchedulePermission(raw: string | null | undefined): SchedulePermission {
  if (raw === 'manage' || raw === 'monitoring' || raw === 'none') {
    return raw
  }
  return 'none'
}

function isAdminPrincipal(principal: Principal) {
  return principal.kind === 'user' && principal.role === 'admin'
}

export function isDevicePermissionAtLeast(
  actual: DevicePermission,
  required: DevicePermission,
) {
  const order: Record<DevicePermission, number> = {
    monitoring: 1,
    control: 2,
    manage: 3,
  }
  return order[actual] >= order[required]
}

export function canManageSchedulesForAssignment(input: {
  devicePermission: DevicePermission
  schedulePermission: SchedulePermission
}) {
  return input.schedulePermission === 'manage' && isDevicePermissionAtLeast(input.devicePermission, 'control')
}

function normalizeDeviceRecord(row: DeviceRecord): DeviceRecord {
  return {
    ...row,
    device_permission: normalizeDevicePermission(row.device_permission),
    schedule_permission: normalizeSchedulePermission(row.schedule_permission),
  }
}

export async function getUserByEmail(db: D1Database, email: string) {
  await ensureRbacCompatibility(db)
  const row = await db
    .prepare(
      `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at
       FROM users
       WHERE lower(email) = lower(?)
       LIMIT 1`,
    )
    .bind(email)
    .first<UserRecord>()

  return row
    ? {
        ...row,
        name: row.name || row.email.split('@')[0] || 'User',
        role: normalizeUserRole(row.role),
        is_active: Number(row.is_active),
      }
    : null
}

export async function getUserById(db: D1Database, id: number, seedAdminEmail?: string) {
  await ensureRbacCompatibility(db, seedAdminEmail)
  const row = await db
    .prepare(
      `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<UserRecord>()

  return row
    ? {
        ...row,
        name: row.name || row.email.split('@')[0] || 'User',
        role: normalizeUserRole(row.role),
        is_active: Number(row.is_active),
      }
    : null
}

export async function updateUserPasswordHash(db: D1Database, userId: number, passwordHash: string) {
  await ensureRbacCompatibility(db)
  return db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(passwordHash, new Date().toISOString(), userId)
    .run()
}

export async function createUser(db: D1Database, input: {
  name: string
  email: string
  passwordHash: string
  role: UserRole
  isActive: boolean
}) {
  await ensureRbacCompatibility(db)
  const nowIso = new Date().toISOString()
  const result = await db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.name, input.email, input.passwordHash, input.role, input.isActive ? 1 : 0, nowIso, nowIso)
    .run()

  return Number(result.meta.last_row_id)
}

export async function ensureSeedAdminUser(db: D1Database, input: {
  email: string
  passwordHash: string
}) {
  await ensureRbacCompatibility(db)
  const nowIso = new Date().toISOString()
  const existing = await getUserByEmail(db, input.email)
  if (existing) {
    if (isLegacySeedAdminPasswordHash(existing.password_hash)) {
      await db
        .prepare(
          `UPDATE users
           SET name = COALESCE(NULLIF(TRIM(name), ''), 'Administrator'),
               password_hash = ?,
               role = 'admin',
               is_active = 1,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(input.passwordHash, nowIso, existing.id)
        .run()
      return existing.id
    }

    await db
      .prepare(
        `UPDATE users
         SET name = COALESCE(NULLIF(TRIM(name), ''), 'Administrator'),
             role = 'admin',
             is_active = 1,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(nowIso, existing.id)
      .run()
    return existing.id
  }

  return createUser(db, {
    name: 'Administrator',
    email: input.email,
    passwordHash: input.passwordHash,
    role: 'admin',
    isActive: true,
  })
}

export async function listUsers(db: D1Database) {
  await ensureRbacCompatibility(db)
  const result = await db
    .prepare(
      `SELECT id, name, email, role, is_active, created_at, updated_at
       FROM users
       ORDER BY role ASC, id ASC`,
    )
    .all<UserSummaryRecord>()

  return result.results.map((row) => ({
    ...row,
    role: normalizeUserRole(row.role),
    is_active: Number(row.is_active),
  }))
}

export async function updateUserProfile(db: D1Database, userId: number, input: {
  email?: string
  name?: string
  passwordHash?: string
}) {
  await ensureRbacCompatibility(db)
  const updates: string[] = []
  const params: unknown[] = []
  if (input.email !== undefined) {
    updates.push('email = ?')
    params.push(input.email)
  }
  if (input.name !== undefined) {
    updates.push('name = ?')
    params.push(input.name)
  }
  if (input.passwordHash !== undefined) {
    updates.push('password_hash = ?')
    params.push(input.passwordHash)
  }
  if (updates.length === 0) {
    return { meta: { changes: 0, last_row_id: 0 } }
  }
  updates.push('updated_at = ?')
  params.push(new Date().toISOString(), userId)
  return db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()
}

export async function updateUserByAdmin(db: D1Database, userId: number, input: {
  email?: string
  name?: string
  passwordHash?: string
  isActive?: boolean
}) {
  await ensureRbacCompatibility(db)
  const updates: string[] = []
  const params: unknown[] = []
  if (input.email !== undefined) {
    updates.push('email = ?')
    params.push(input.email)
  }
  if (input.name !== undefined) {
    updates.push('name = ?')
    params.push(input.name)
  }
  if (input.passwordHash !== undefined) {
    updates.push('password_hash = ?')
    params.push(input.passwordHash)
  }
  if (input.isActive !== undefined) {
    updates.push('is_active = ?')
    params.push(input.isActive ? 1 : 0)
  }
  if (updates.length === 0) {
    return { meta: { changes: 0, last_row_id: 0 } }
  }
  updates.push('updated_at = ?')
  params.push(new Date().toISOString(), userId)
  return db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()
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
  await ensureRbacCompatibility(db)
  return db
    .prepare(
      `SELECT s.id AS session_id, s.user_id, u.email, u.role, u.is_active,
              u.name,
              s.refresh_token_hash, s.expires_at, s.created_at,
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
  await ensureRbacCompatibility(db)

  if (principal.kind === 'user' && !isAdminPrincipal(principal)) {
    const result = await db
      .prepare(
        `SELECT d.id, d.device_id,
                COALESCE(NULLIF(TRIM(d.mqtt_device_id), ''), d.device_id) AS mqtt_device_id,
                d.name, d.location,
                COALESCE(NULLIF(TRIM(d.command_channel), ''), 'POWER') AS command_channel,
                ud.device_permission,
                ud.schedule_permission
         FROM devices d
         INNER JOIN user_devices ud ON ud.device_id = d.id
         WHERE ud.user_id = ?
         ORDER BY d.id ASC`,
      )
      .bind(principal.userId)
      .all<DeviceRecord>()
    return result.results.map(normalizeDeviceRecord)
  }

  const result = await db
    .prepare(
      `SELECT id, device_id,
              COALESCE(NULLIF(TRIM(mqtt_device_id), ''), device_id) AS mqtt_device_id,
              name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel,
              'manage' AS device_permission,
              'manage' AS schedule_permission
       FROM devices
       ORDER BY id ASC`,
    )
    .all<DeviceRecord>()
  return result.results.map(normalizeDeviceRecord)
}

export async function getDeviceByDeviceIdForPrincipal(
  db: D1Database,
  principal: Principal,
  deviceId: string,
  requiredPermission: DevicePermission = 'monitoring',
) {
  await ensureDeviceCommandChannelCompatibility(db)
  await ensureRbacCompatibility(db)

  if (principal.kind === 'user' && !isAdminPrincipal(principal)) {
    const row = await db
      .prepare(
        `SELECT d.id, d.device_id,
                COALESCE(NULLIF(TRIM(d.mqtt_device_id), ''), d.device_id) AS mqtt_device_id,
                d.name, d.location,
                COALESCE(NULLIF(TRIM(d.command_channel), ''), 'POWER') AS command_channel,
                ud.device_permission,
                ud.schedule_permission
         FROM devices d
         INNER JOIN user_devices ud ON ud.device_id = d.id
         WHERE ud.user_id = ? AND d.device_id = ?
         LIMIT 1`,
      )
      .bind(principal.userId, deviceId)
      .first<DeviceRecord>()
    const normalized = row ? normalizeDeviceRecord(row) : null
    if (!normalized || !isDevicePermissionAtLeast(normalized.device_permission, requiredPermission)) {
      return null
    }
    return normalized
  }

  const row = await db
    .prepare(
      `SELECT id, device_id,
              COALESCE(NULLIF(TRIM(mqtt_device_id), ''), device_id) AS mqtt_device_id,
              name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel,
              'manage' AS device_permission,
              'manage' AS schedule_permission
       FROM devices
       WHERE device_id = ?
       LIMIT 1`,
    )
    .bind(deviceId)
    .first<DeviceRecord>()
  return row ? normalizeDeviceRecord(row) : null
}

export async function getDeviceByDeviceId(db: D1Database, deviceId: string) {
  await ensureDeviceCommandChannelCompatibility(db)

  const row = await db
    .prepare(
      `SELECT id, device_id,
              COALESCE(NULLIF(TRIM(mqtt_device_id), ''), device_id) AS mqtt_device_id,
              name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel,
              'manage' AS device_permission,
              'manage' AS schedule_permission
       FROM devices
       WHERE device_id = ?
       LIMIT 1`,
    )
    .bind(deviceId)
    .first<DeviceRecord>()
  return row ? normalizeDeviceRecord(row) : null
}

export async function listAllDevices(db: D1Database) {
  await ensureDeviceCommandChannelCompatibility(db)
  const result = await db
    .prepare(
      `SELECT id, device_id,
              COALESCE(NULLIF(TRIM(mqtt_device_id), ''), device_id) AS mqtt_device_id,
              name, location,
              COALESCE(NULLIF(TRIM(command_channel), ''), 'POWER') AS command_channel,
              'manage' AS device_permission,
              'manage' AS schedule_permission
       FROM devices
       ORDER BY id ASC`,
    )
    .all<DeviceRecord>()
  return result.results.map(normalizeDeviceRecord)
}

export async function getUserDeviceAssignment(db: D1Database, userId: number, deviceInternalId: number) {
  await ensureRbacCompatibility(db)
  const row = await db
    .prepare(
      `SELECT device_permission, schedule_permission
       FROM user_devices
       WHERE user_id = ? AND device_id = ?
       LIMIT 1`,
    )
    .bind(userId, deviceInternalId)
    .first<{ device_permission: string; schedule_permission: string }>()
  if (!row) {
    return null
  }
  return {
    devicePermission: normalizeDevicePermission(row.device_permission),
    schedulePermission: normalizeSchedulePermission(row.schedule_permission),
  }
}

export async function resolveDeviceAccess(
  db: D1Database,
  principal: Principal,
  deviceId: string,
  requiredPermission: DevicePermission = 'monitoring',
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

  if (isAdminPrincipal(principal)) {
    return { device, access: 'ok' }
  }

  const assignment = await getUserDeviceAssignment(db, principal.userId, device.id)
  if (!assignment || !isDevicePermissionAtLeast(assignment.devicePermission, requiredPermission)) {
    return { device, access: 'forbidden' }
  }

  return {
    device: {
      ...device,
      device_permission: assignment.devicePermission,
      schedule_permission: assignment.schedulePermission,
    },
    access: 'ok',
  }
}

export async function listUserDeviceAssignments(db: D1Database, userId: number) {
  await ensureDeviceCommandChannelCompatibility(db)
  await ensureRbacCompatibility(db)
  const result = await db
    .prepare(
      `SELECT ud.user_id,
              ud.device_id,
              d.device_id AS public_device_id,
              d.name,
              d.location,
              COALESCE(NULLIF(TRIM(d.command_channel), ''), 'POWER') AS command_channel,
              ud.device_permission,
              ud.schedule_permission,
              ud.assigned_by_user_id,
              ud.created_at,
              ud.updated_at
       FROM user_devices ud
       INNER JOIN devices d ON d.id = ud.device_id
       WHERE ud.user_id = ?
       ORDER BY d.id ASC`,
    )
    .bind(userId)
    .all<UserDeviceAssignmentRecord>()

  return result.results.map((row) => ({
    ...row,
    device_permission: normalizeDevicePermission(row.device_permission),
    schedule_permission: normalizeSchedulePermission(row.schedule_permission),
  }))
}

export async function replaceUserDeviceAssignments(
  db: D1Database,
  input: {
    targetUserId: number
    actorUserId: number
    assignments: Array<{
      deviceInternalId: number
      devicePermission: DevicePermission
      schedulePermission: SchedulePermission
    }>
  },
) {
  await ensureRbacCompatibility(db)
  const nowIso = new Date().toISOString()
  await db.prepare('DELETE FROM user_devices WHERE user_id = ?').bind(input.targetUserId).run()

  for (const assignment of input.assignments) {
    await db
      .prepare(
        `INSERT INTO user_devices
         (user_id, device_id, role, device_permission, schedule_permission, assigned_by_user_id, created_at, updated_at)
         VALUES (?, ?, 'member', ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.targetUserId,
        assignment.deviceInternalId,
        assignment.devicePermission,
        assignment.schedulePermission,
        input.actorUserId,
        nowIso,
        nowIso,
      )
      .run()
  }

  await db
    .prepare(
      `UPDATE device_schedules
       SET enabled = 0, updated_at = ?
       WHERE user_id = ?
         AND device_id NOT IN (
           SELECT device_id
           FROM user_devices
           WHERE user_id = ?
             AND device_permission IN ('control', 'manage')
             AND schedule_permission = 'manage'
         )`,
    )
    .bind(nowIso, input.targetUserId, input.targetUserId)
    .run()
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
         INNER JOIN user_devices ud ON ud.device_id = ds.device_id AND ud.user_id = ?
         WHERE ds.id = ?
           AND ud.schedule_permission IN ('monitoring', 'manage')
         LIMIT 1`,
      )
      .bind(principal.userId, scheduleId)
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

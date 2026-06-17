import { describe, expect, it } from 'vitest'
import { sign } from 'hono/jwt'
import { createApp } from '../src/app'
import type { AppDatabase, DbAllResult, DbPreparedStatement, DbRunResult } from '../src/types/db'

type QueryResolver = (
  sql: string,
  params: unknown[],
  mode: 'first' | 'all' | 'run',
) => unknown

type TestUser = {
  id: number
  name?: string
  email: string
  role: 'admin' | 'member'
  isActive: number
}

type Assignment = {
  userId: number
  devicePermission: 'monitoring' | 'control' | 'manage'
  schedulePermission: 'none' | 'monitoring' | 'manage'
}

const DEVICE_ROW = {
  id: 44,
  device_id: 'lampu-rbac',
  mqtt_device_id: 'lampu-rbac',
  name: 'Lampu RBAC',
  location: 'Lab',
  command_channel: 'POWER',
  device_permission: 'manage',
  schedule_permission: 'manage',
}

function createDbMock(resolver: QueryResolver): AppDatabase {
  return {
    dialect: 'sqlite',
    prepare(sql: string): DbPreparedStatement {
      let params: unknown[] = []
      return {
        bind(...nextParams: unknown[]) {
          params = nextParams
          return this
        },
        async first<T>() {
          return (resolver(sql, params, 'first') as T | null) ?? null
        },
        async all<T>() {
          const results = (resolver(sql, params, 'all') as T[]) ?? []
          return { results } satisfies DbAllResult<T>
        },
        async run() {
          const resolved = resolver(sql, params, 'run') as DbRunResult | null
          if (resolved) return resolved
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        },
      }
    },
  }
}

function compatibilityRun(sql: string): DbRunResult | null {
  if (
    sql.startsWith('ALTER TABLE') ||
    sql.startsWith('UPDATE users') ||
    sql.startsWith('UPDATE user_devices') ||
    sql.startsWith('UPDATE device_schedules') ||
    sql.includes('INSERT INTO rate_limit_hits') ||
    sql === 'UPDATE rate_limit_hits SET request_count = ?, updated_at = ? WHERE rate_key = ?' ||
    sql.startsWith('DELETE FROM user_devices') ||
    sql.startsWith('INSERT INTO idempotency_records') ||
    sql.startsWith('UPDATE auth_sessions')
  ) {
    return { meta: { changes: 1, last_row_id: 0 } }
  }
  return null
}

function userRow(user: TestUser) {
  return {
    id: user.id,
    name: user.name ?? user.email.split('@')[0],
    email: user.email,
    password_hash: 'unused',
    role: user.role,
    is_active: user.isActive,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: null,
  }
}

async function userToken(user: TestUser) {
  const nowSec = Math.floor(Date.now() / 1000)
  return sign(
    {
      sub: String(user.id),
      email: user.email,
      type: 'user',
      iat: nowSec,
      exp: nowSec + 3600,
    },
    'test-jwt-secret',
  )
}

function baseEnv(db: AppDatabase) {
  return {
    DB: db as any,
    JWT_SECRET: 'test-jwt-secret',
    MQTT_WS_URL: 'wss://broker.example/mqtt',
  } as any
}

function scheduleRow(userId: number) {
  return {
    id: 701,
    user_id: userId,
    created_by_user_id: 1,
    internal_device_id: DEVICE_ROW.id,
    action: 'ON',
    cron_expr: '*/5 * * * *',
    timezone: 'Asia/Jakarta',
    enabled: 1,
    next_run_at: Date.now() + 300_000,
    last_run_at: null,
    start_at: null,
    end_at: null,
    window_group_id: null,
    window_start_minute: null,
    window_end_minute: null,
    enforce_every_minute: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    device_id: DEVICE_ROW.device_id,
    user_email: userId === 2 ? 'member@example.com' : 'admin@example.com',
  }
}

function createPermissionDb(input: {
  principal: TestUser
  target?: TestUser
  assignment?: Assignment | null
  scheduleInsertUserId?: number
}) {
  const target = input.target ?? input.principal
  return createDbMock((sql, params, mode) => {
    if (mode === 'first') {
      if (sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
        const requestedId = Number(params[0])
        if (requestedId === input.principal.id) return userRow(input.principal)
        if (requestedId === target.id) return userRow(target)
        return null
      }
      if (sql.includes('FROM users') && sql.includes('WHERE lower(email) = lower(?)')) {
        const requestedEmail = String(params[0]).toLowerCase()
        if (requestedEmail === input.principal.email.toLowerCase()) return userRow(input.principal)
        if (requestedEmail === target.email.toLowerCase()) return userRow(target)
        return null
      }
      if (sql.includes('FROM rate_limit_hits')) return null
      if (sql.includes('FROM idempotency_records')) return null
      if (sql.includes('FROM devices') && sql.includes('WHERE device_id = ?')) return DEVICE_ROW
      if (sql.includes('SELECT device_permission, schedule_permission')) {
        if (!input.assignment) return null
        return {
          device_permission: input.assignment.devicePermission,
          schedule_permission: input.assignment.schedulePermission,
        }
      }
      if (sql.includes('FROM device_schedules ds') && sql.includes('WHERE ds.id = ?')) {
        if (!input.assignment || input.assignment.schedulePermission === 'none') return null
        if (sql.includes("ud.schedule_permission = 'manage'") && input.assignment.schedulePermission !== 'manage') return null
        if (
          sql.includes("ud.device_permission IN ('control', 'manage')") &&
          input.assignment.devicePermission === 'monitoring'
        ) {
          return null
        }
        return scheduleRow(input.scheduleInsertUserId ?? target.id)
      }
      return null
    }

    if (mode === 'all') {
      if (sql.includes('FROM devices') && sql.includes('ORDER BY id ASC')) return [DEVICE_ROW]
      if (sql.includes('FROM device_schedules ds')) {
        return input.assignment && input.assignment.schedulePermission !== 'none'
          ? [scheduleRow(input.scheduleInsertUserId ?? target.id)]
          : []
      }
      if (sql.includes('FROM schedule_runs')) {
        return [
          {
            id: 1,
            schedule_id: 701,
            planned_at: Date.now(),
            executed_at: null,
            request_id: null,
            status: 'queued',
            error_message: null,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ]
      }
      return []
    }

    if (mode === 'run') {
      if (sql.startsWith('INSERT INTO device_schedules')) {
        return { meta: { changes: 1, last_row_id: 701 } } satisfies DbRunResult
      }
      return compatibilityRun(sql)
    }

    return null
  })
}

describe('RBAC route guards', () => {
  it('blocks member users from admin user endpoints', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({ principal: member })
    const app = createApp()
    const response = await app.request(
      '/api/v1/users',
      { headers: { authorization: `Bearer ${await userToken(member)}` } },
      baseEnv(db),
    )
    const payload = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('FORBIDDEN_ADMIN_REQUIRED')
  })

  it('blocks monitoring-only device users from executing commands', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({
      principal: member,
      assignment: {
        userId: member.id,
        devicePermission: 'monitoring',
        schedulePermission: 'none',
      },
    })
    const app = createApp()
    const response = await app.request(
      '/api/v1/commands/execute',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await userToken(member)}`,
          'content-type': 'application/json',
          'idempotency-key': 'rbac-command-monitoring',
        },
        body: JSON.stringify({
          deviceId: DEVICE_ROW.device_id,
          action: 'ON',
          requestId: 'req-rbac-command-monitoring',
        }),
      },
      baseEnv(db),
    )
    const payload = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('FORBIDDEN_DEVICE_ACCESS')
  })

  it('blocks schedule mutation when device has control but schedule permission is not manage', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({
      principal: member,
      assignment: {
        userId: member.id,
        devicePermission: 'control',
        schedulePermission: 'monitoring',
      },
    })
    const app = createApp()
    const response = await app.request(
      '/api/v1/schedules',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await userToken(member)}`,
          'content-type': 'application/json',
          'idempotency-key': 'rbac-schedule-control-only',
        },
        body: JSON.stringify({
          deviceId: DEVICE_ROW.device_id,
          action: 'ON',
          cron: '*/5 * * * *',
          timezone: 'Asia/Jakarta',
          enabled: true,
        }),
      },
      baseEnv(db),
    )
    const payload = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('FORBIDDEN_DEVICE_ACCESS')
  })

  it('hides schedules and runs when schedule permission is none', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({
      principal: member,
      target: { id: 2, email: 'owner@example.com', role: 'member', isActive: 1 },
      assignment: {
        userId: member.id,
        devicePermission: 'control',
        schedulePermission: 'none',
      },
      scheduleInsertUserId: 2,
    })
    const app = createApp()
    const listResponse = await app.request(
      '/api/v1/schedules',
      { headers: { authorization: `Bearer ${await userToken(member)}` } },
      baseEnv(db),
    )
    const listPayload = (await listResponse.json()) as { success: boolean; data: unknown[] }

    expect(listResponse.status).toBe(200)
    expect(listPayload.success).toBe(true)
    expect(listPayload.data).toHaveLength(0)

    const runsResponse = await app.request(
      '/api/v1/schedules/701/runs',
      { headers: { authorization: `Bearer ${await userToken(member)}` } },
      baseEnv(db),
    )
    const runsPayload = (await runsResponse.json()) as { error: { code: string } }

    expect(runsResponse.status).toBe(404)
    expect(runsPayload.error.code).toBe('SCHEDULE_NOT_FOUND')
  })

  it('lets schedule monitoring users read schedules and runs by assigned device', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({
      principal: member,
      target: { id: 2, email: 'owner@example.com', role: 'member', isActive: 1 },
      assignment: {
        userId: member.id,
        devicePermission: 'monitoring',
        schedulePermission: 'monitoring',
      },
      scheduleInsertUserId: 2,
    })
    const app = createApp()
    const listResponse = await app.request(
      '/api/v1/schedules',
      { headers: { authorization: `Bearer ${await userToken(member)}` } },
      baseEnv(db),
    )
    const listPayload = (await listResponse.json()) as { success: boolean; data: Array<{ userId: number }> }

    expect(listResponse.status).toBe(200)
    expect(listPayload.success).toBe(true)
    expect(listPayload.data[0]?.userId).toBe(2)

    const runsResponse = await app.request(
      '/api/v1/schedules/701/runs',
      { headers: { authorization: `Bearer ${await userToken(member)}` } },
      baseEnv(db),
    )
    const runsPayload = (await runsResponse.json()) as { success: boolean; data: unknown[] }

    expect(runsResponse.status).toBe(200)
    expect(runsPayload.success).toBe(true)
    expect(runsPayload.data).toHaveLength(1)
  })

  it('blocks schedule manage when device permission is still monitoring', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({
      principal: member,
      assignment: {
        userId: member.id,
        devicePermission: 'monitoring',
        schedulePermission: 'manage',
      },
    })
    const app = createApp()
    const response = await app.request(
      '/api/v1/schedules',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await userToken(member)}`,
          'content-type': 'application/json',
          'idempotency-key': 'rbac-schedule-monitoring-manage',
        },
        body: JSON.stringify({
          deviceId: DEVICE_ROW.device_id,
          action: 'ON',
          cron: '*/5 * * * *',
          timezone: 'Asia/Jakarta',
          enabled: true,
        }),
      },
      baseEnv(db),
    )
    const payload = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(403)
    expect(payload.error.code).toBe('FORBIDDEN_DEVICE_ACCESS')
  })

  it('allows schedule mutation with device control and schedule manage', async () => {
    const member: TestUser = { id: 1, email: 'member@example.com', role: 'member', isActive: 1 }
    const db = createPermissionDb({
      principal: member,
      assignment: {
        userId: member.id,
        devicePermission: 'control',
        schedulePermission: 'manage',
      },
    })
    const app = createApp()
    const response = await app.request(
      '/api/v1/schedules',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await userToken(member)}`,
          'content-type': 'application/json',
          'idempotency-key': 'rbac-schedule-allowed',
        },
        body: JSON.stringify({
          deviceId: DEVICE_ROW.device_id,
          action: 'ON',
          cron: '*/5 * * * *',
          timezone: 'Asia/Jakarta',
          enabled: true,
        }),
      },
      baseEnv(db),
    )
    const payload = (await response.json()) as { success: boolean; data: { deviceId: string } }

    expect(response.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.deviceId).toBe(DEVICE_ROW.device_id)
  })

  it('lets admin create member, assign permissions, and create target member schedule', async () => {
    const admin: TestUser = { id: 1, email: 'admin@example.com', role: 'admin', isActive: 1 }
    let member: TestUser | null = null
    let assignment: Assignment | null = null

    const db = createDbMock((sql, params, mode) => {
      if (mode === 'first') {
        if (sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
          const id = Number(params[0])
          if (id === admin.id) return userRow(admin)
          if (member && id === member.id) return userRow(member)
          return null
        }
        if (sql.includes('FROM users') && sql.includes('WHERE lower(email) = lower(?)')) {
          const email = String(params[0]).toLowerCase()
          if (email === admin.email.toLowerCase()) return userRow(admin)
          if (member && email === member.email.toLowerCase()) return userRow(member)
          return null
        }
        if (sql.includes('FROM idempotency_records')) return null
        if (sql.includes('FROM devices') && sql.includes('WHERE device_id = ?')) return DEVICE_ROW
        if (sql.includes('SELECT device_permission, schedule_permission')) {
          return assignment
            ? {
                device_permission: assignment.devicePermission,
                schedule_permission: assignment.schedulePermission,
              }
            : null
        }
        if (sql.includes('FROM device_schedules ds') && sql.includes('WHERE ds.id = ?')) {
          return scheduleRow(member?.id ?? 2)
        }
        return null
      }

      if (mode === 'all') {
        if (sql.includes('FROM devices') && sql.includes('ORDER BY id ASC')) return [DEVICE_ROW]
        if (sql.includes('FROM user_devices ud') && member && assignment) {
          return [
            {
              user_id: member.id,
              device_id: DEVICE_ROW.id,
              public_device_id: DEVICE_ROW.device_id,
              name: DEVICE_ROW.name,
              location: DEVICE_ROW.location,
              command_channel: DEVICE_ROW.command_channel,
              device_permission: assignment.devicePermission,
              schedule_permission: assignment.schedulePermission,
              assigned_by_user_id: admin.id,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ]
        }
        return []
      }

      if (mode === 'run') {
        if (sql.startsWith('INSERT INTO users')) {
          member = {
            id: 2,
            name: String(params[0]),
            email: String(params[1]),
            role: 'member',
            isActive: Number(params[4]),
          }
          return { meta: { changes: 1, last_row_id: 2 } } satisfies DbRunResult
        }
        if (sql.startsWith('INSERT INTO user_devices')) {
          assignment = {
            userId: Number(params[0]),
            devicePermission: params[2] as Assignment['devicePermission'],
            schedulePermission: params[3] as Assignment['schedulePermission'],
          }
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }
        if (sql.startsWith('INSERT INTO device_schedules')) {
          return { meta: { changes: 1, last_row_id: 701 } } satisfies DbRunResult
        }
        return compatibilityRun(sql)
      }

      return null
    })

    const app = createApp()
    const adminAuthorization = `Bearer ${await userToken(admin)}`

    const createResponse = await app.request(
      '/api/v1/users',
      {
        method: 'POST',
        headers: {
          authorization: adminAuthorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Member Test',
          email: 'member@example.com',
          password: 'member12345',
          isActive: true,
        }),
      },
      baseEnv(db),
    )
    const createPayload = (await createResponse.json()) as { success: boolean; data: { name: string } }
    expect(createResponse.status).toBe(201)
    expect(createPayload.data.name).toBe('Member Test')

    const assignResponse = await app.request(
      '/api/v1/users/2/assignments',
      {
        method: 'PUT',
        headers: {
          authorization: adminAuthorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          assignments: [
            {
              deviceId: DEVICE_ROW.device_id,
              assigned: true,
              devicePermission: 'control',
              schedulePermission: 'manage',
            },
          ],
        }),
      },
      baseEnv(db),
    )
    expect(assignResponse.status).toBe(200)

    const scheduleResponse = await app.request(
      '/api/v1/schedules',
      {
        method: 'POST',
        headers: {
          authorization: adminAuthorization,
          'content-type': 'application/json',
          'idempotency-key': 'rbac-admin-target-schedule',
        },
        body: JSON.stringify({
          targetUserId: 2,
          deviceId: DEVICE_ROW.device_id,
          action: 'ON',
          cron: '*/5 * * * *',
          timezone: 'Asia/Jakarta',
          enabled: true,
        }),
      },
      baseEnv(db),
    )
    const payload = (await scheduleResponse.json()) as { success: boolean; data: { userId: number } }

    expect(scheduleResponse.status).toBe(201)
    expect(payload.success).toBe(true)
    expect(payload.data.userId).toBe(2)
  })

  it('rejects inactive users at login', async () => {
    const inactive: TestUser = { id: 1, email: 'inactive@example.com', role: 'member', isActive: 0 }
    const db = createDbMock((sql, params, mode) => {
      if (mode === 'first') {
        if (sql.includes('FROM rate_limit_hits')) return null
        if (sql.includes('FROM users') && sql.includes('WHERE lower(email) = lower(?)')) {
          return String(params[0]).toLowerCase() === inactive.email ? userRow(inactive) : null
        }
        return null
      }
      if (mode === 'run') return compatibilityRun(sql)
      return []
    })
    const app = createApp()
    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: inactive.email,
          password: 'inactive12345',
        }),
      },
      baseEnv(db),
    )
    const payload = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(401)
    expect(payload.error.code).toBe('AUTH_INVALID_TOKEN')
  })

  it('rejects inactive users at refresh', async () => {
    const inactive: TestUser = { id: 1, email: 'inactive@example.com', role: 'member', isActive: 0 }
    const db = createDbMock((sql, _params, mode) => {
      if (mode === 'first') {
        if (sql.includes('FROM auth_sessions s')) {
          return {
          session_id: 99,
          user_id: inactive.id,
          name: 'Inactive User',
          email: inactive.email,
            role: inactive.role,
            is_active: inactive.isActive,
            refresh_token_hash: 'hash',
            expires_at: Date.now() + 60_000,
            created_at: '2026-01-01T00:00:00.000Z',
            last_used_at: null,
            rotated_at: null,
            revoked_at: null,
            replaced_by_session_id: null,
          }
        }
        return null
      }
      if (mode === 'run') return compatibilityRun(sql)
      return []
    })
    const app = createApp()
    const response = await app.request(
      '/api/v1/auth/refresh',
      {
        method: 'POST',
        headers: {
          cookie: 'refresh_token=refresh-value',
        },
      },
      baseEnv(db),
    )
    const payload = (await response.json()) as { error: { code: string } }

    expect(response.status).toBe(401)
    expect(payload.error.code).toBe('AUTH_INVALID_TOKEN')
  })
})

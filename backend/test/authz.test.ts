import { afterEach, describe, expect, it, vi } from 'vitest'
import { sign } from 'hono/jwt'
import { createApp } from '../src/app'
import type { AppDatabase, DbAllResult, DbPreparedStatement, DbRunResult } from '../src/types/db'

type QueryResolver = (
  sql: string,
  params: unknown[],
  mode: 'first' | 'all' | 'run',
) => unknown

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('auth and access verification', () => {
  it('returns AUTH_EXPIRED_TOKEN for expired JWT', async () => {
    const db = createDbMock((sql, _params, mode) => {
      if (mode === 'first' && sql.includes('FROM integration_clients')) {
        return null
      }
      if (mode === 'all') return []
      if (mode === 'run') return { meta: { changes: 1, last_row_id: 0 } }
      return null
    })

    const app = createApp()
    const token = await sign(
      {
        sub: '1',
        email: 'expired@example.com',
        type: 'user',
        iat: 1,
        exp: 2,
      },
      'test-jwt-secret',
    )

    const response = await app.request(
      '/api/v1/status',
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
      {
        DB: db as any,
        JWT_SECRET: 'test-jwt-secret',
        MQTT_WS_URL: 'wss://broker.example/mqtt',
      } as any,
    )

    const payload = (await response.json()) as {
      success: boolean
      error: { code: string; message: string } | null
    }

    expect(response.status).toBe(401)
    expect(payload.success).toBe(false)
    expect(payload.error?.code).toBe('AUTH_EXPIRED_TOKEN')
  })

  it('blocks user from executing command on device they do not own', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)

    const db = createDbMock((sql, _params, mode) => {
      if (mode === 'first') {
        if (sql === 'SELECT id, email FROM users WHERE id = ? LIMIT 1') {
          return { id: 1, email: 'user-a@example.com' }
        }
        if (sql.includes('FROM idempotency_records')) {
          return null
        }
        if (sql.includes('FROM rate_limit_hits')) {
          return null
        }
        if (sql.includes('FROM devices') && sql.includes('WHERE device_id = ?')) {
          return {
            id: 99,
            device_id: 'device-user-b',
            name: 'Device User B',
            location: 'B',
            command_channel: 'POWER',
          }
        }
        if (sql === 'SELECT 1 AS ok FROM user_devices WHERE user_id = ? AND device_id = ? LIMIT 1') {
          return null
        }
        return null
      }

      if (mode === 'run') {
        if (sql.startsWith('ALTER TABLE devices ADD COLUMN command_channel')) {
          return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
        }
        if (sql.startsWith('UPDATE devices')) {
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }
        if (sql.includes('INSERT INTO rate_limit_hits')) {
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }
        if (sql === 'UPDATE rate_limit_hits SET request_count = ?, updated_at = ? WHERE rate_key = ?') {
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }
        throw new Error(`Unexpected run query in authz test: ${sql}`)
      }

      return []
    })

    const app = createApp()
    const nowSec = Math.floor(Date.now() / 1000)
    const token = await sign(
      {
        sub: '1',
        email: 'user-a@example.com',
        type: 'user',
        iat: nowSec,
        exp: nowSec + 3600,
      },
      'test-jwt-secret',
    )

    const response = await app.request(
      '/api/v1/commands/execute',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'idempotency-key': 'idem-forbidden-device',
        },
        body: JSON.stringify({
          deviceId: 'device-user-b',
          action: 'ON',
          requestId: 'req-forbidden-device',
        }),
      },
      {
        DB: db as any,
        JWT_SECRET: 'test-jwt-secret',
        MQTT_WS_URL: 'wss://broker.example/mqtt',
      } as any,
    )

    const payload = (await response.json()) as {
      success: boolean
      error: { code: string; message: string } | null
    }

    expect(response.status).toBe(403)
    expect(payload.success).toBe(false)
    expect(payload.error?.code).toBe('FORBIDDEN_DEVICE_ACCESS')
  })
})

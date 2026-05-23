import { afterEach, describe, expect, it, vi } from 'vitest'
import { sign } from 'hono/jwt'
import type { AppDatabase, DbAllResult, DbPreparedStatement, DbRunResult } from '../src/types/db'

const { readTasmotaDiscoveryOverWsMock } = vi.hoisted(() => ({
  readTasmotaDiscoveryOverWsMock: vi.fn(),
}))

vi.mock('../src/lib/mqtt-ws', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/mqtt-ws')>('../src/lib/mqtt-ws')
  return {
    ...actual,
    readTasmotaDiscoveryOverWs: readTasmotaDiscoveryOverWsMock,
  }
})

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
  readTasmotaDiscoveryOverWsMock.mockReset()
  vi.restoreAllMocks()
})

describe('device discovery integrations', () => {
  it('expands one multi-power tasmota device into one entity per POWER channel', async () => {
    readTasmotaDiscoveryOverWsMock.mockResolvedValue([
      {
        deviceId: 'tasmota_857B40',
        online: true,
        power: 'OFF',
        powerStates: {
          POWER1: 'OFF',
          POWER2: 'OFF',
          POWER3: 'OFF',
          POWER4: 'OFF',
          POWER5: 'OFF',
          POWER6: 'OFF',
        },
        commandChannels: ['POWER1', 'POWER2', 'POWER3', 'POWER4', 'POWER5', 'POWER6'],
        suggestedCommandChannel: 'POWER1',
        friendlyName: 'Tasmota',
        tasmotaTopic: 'tasmota_857B40',
        sources: ['lwt', 'status', 'status11'],
        lastSeenAt: Date.parse('2026-03-27T12:00:00.000Z'),
      },
    ])

    const db = createDbMock((sql, _params, mode) => {
      if (mode === 'first' && sql === 'SELECT id, email FROM users WHERE id = ? LIMIT 1') {
        return { id: 1, email: 'user@example.com' }
      }

      if (mode === 'all') {
        if (sql.includes('FROM devices d') && sql.includes('INNER JOIN user_devices ud')) {
          return []
        }
        if (sql.includes('SELECT DISTINCT d.device_id')) {
          return []
        }
        return []
      }

      if (mode === 'run') {
        if (sql.startsWith('ALTER TABLE devices ADD COLUMN command_channel')) {
          return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
        }
        if (sql.startsWith('ALTER TABLE devices ADD COLUMN mqtt_device_id')) {
          return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
        }
        if (sql.startsWith('UPDATE devices')) {
          return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
        }
      }

      return null
    })

    const nowSec = Math.floor(Date.now() / 1000)
    const token = await sign(
      {
        sub: '1',
        email: 'user@example.com',
        type: 'user',
        iat: nowSec,
        exp: nowSec + 3600,
      },
      'test-jwt-secret',
    )

    const { createApp } = await import('../src/app')
    const app = createApp()

    const response = await app.request(
      '/api/v1/devices/discovery?waitMs=1800&maxDevices=50',
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
      data: {
        waitMs: number
        maxDevices: number
        devices: Array<{
          deviceId: string
          mqttDeviceId: string
          commandChannel: string
          power: string
          suggestedName: string
          alreadyLinked: boolean
          alreadyRegistered: boolean
        }>
      }
    }

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.data.waitMs).toBe(1800)
    expect(payload.data.maxDevices).toBe(50)
    expect(payload.data.devices).toHaveLength(6)
    expect(payload.data.devices.map((device) => device.deviceId)).toEqual([
      'tasmota_857B40__POWER1',
      'tasmota_857B40__POWER2',
      'tasmota_857B40__POWER3',
      'tasmota_857B40__POWER4',
      'tasmota_857B40__POWER5',
      'tasmota_857B40__POWER6',
    ])
    expect(payload.data.devices.map((device) => device.commandChannel)).toEqual([
      'POWER1',
      'POWER2',
      'POWER3',
      'POWER4',
      'POWER5',
      'POWER6',
    ])
    expect(payload.data.devices.every((device) => device.mqttDeviceId === 'tasmota_857B40')).toBe(true)
    expect(payload.data.devices.every((device) => device.power === 'OFF')).toBe(true)
    expect(payload.data.devices[0]?.suggestedName).toBe('Tasmota POWER1')
    expect(payload.data.devices.every((device) => !device.alreadyLinked && !device.alreadyRegistered)).toBe(true)

    expect(readTasmotaDiscoveryOverWsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'wss://broker.example/mqtt',
        snapshotWaitMs: 1800,
        maxDevices: 50,
      }),
    )
  })
})

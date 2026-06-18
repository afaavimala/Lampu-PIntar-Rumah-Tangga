import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase, DbAllResult, DbPreparedStatement, DbRunResult } from '../src/types/db'
import { runDueSchedules } from '../src/lib/scheduler-runner'
import { publishMqttOverWs } from '../src/lib/mqtt-ws'

vi.mock('../src/lib/mqtt-ws', () => ({
  publishMqttOverWs: vi.fn(async () => undefined),
}))

vi.mock('../src/lib/commands', () => ({
  createCommandEnvelope: vi.fn((input: { deviceId: string; action: 'ON' | 'OFF'; requestId: string }) => ({
    deviceId: input.deviceId,
    action: input.action,
    requestId: input.requestId,
    commandChannel: 'POWER',
  })),
  logCommandDispatch: vi.fn(async () => undefined),
}))

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
  window_group_id?: string | null
  window_start_minute?: number | null
  window_end_minute?: number | null
  enforce_every_minute?: number | null
}

class SchedulerDbMock implements AppDatabase {
  readonly dialect = 'sqlite' as const
  private readonly dueRows: DueScheduleRow[]
  private readonly runKeys = new Set<string>()

  constructor(rows: DueScheduleRow[]) {
    this.dueRows = rows
  }

  prepare(sql: string): DbPreparedStatement {
    const db = this
    const query = sql
    let params: unknown[] = []

    return {
      bind(...nextParams: unknown[]) {
        params = nextParams
        return this
      },
      async first<T>() {
        return null as T | null
      },
      async all<T>() {
        if (query.includes('FROM device_schedules ds') && query.includes('LIMIT 50')) {
          return { results: db.dueRows as T[] } satisfies DbAllResult<T>
        }
        throw new Error(`Unexpected all() query in test: ${query}`)
      },
      async run() {
        if (query.startsWith('ALTER TABLE devices ADD COLUMN command_channel')) {
          return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
        }
        if (query.startsWith('ALTER TABLE devices ADD COLUMN mqtt_device_id')) {
          return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
        }

        if (query.startsWith('UPDATE devices')) {
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }

        if (query.includes('INSERT OR IGNORE INTO schedule_runs')) {
          const key = `${String(params[0])}:${String(params[2])}`
          if (db.runKeys.has(key)) {
            return { meta: { changes: 0, last_row_id: 0 } } satisfies DbRunResult
          }
          db.runKeys.add(key)
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }

        if (query.startsWith('UPDATE schedule_runs')) {
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }

        if (query.startsWith('UPDATE device_schedules')) {
          return { meta: { changes: 1, last_row_id: 0 } } satisfies DbRunResult
        }

        throw new Error(`Unexpected run() query in test: ${query}`)
      },
    }
  }
}

describe('scheduler runner dedup', () => {
  beforeEach(() => {
    vi.mocked(publishMqttOverWs).mockClear()
  })

  it('avoids double publish for the same schedule slot', async () => {
    const now = Date.now()
    const db = new SchedulerDbMock([
      {
        schedule_id: 101,
        user_id: 1,
        device_internal_id: 11,
        device_id: 'lampu-uji-dedup',
        mqtt_device_id: 'lampu-uji-dedup',
        command_channel: 'POWER',
        action: 'ON',
        cron_expr: '* * * * *',
        timezone: 'Asia/Jakarta',
        next_run_at: now - 5_000,
      },
    ])

    const first = await runDueSchedules({
      DB: db as any,
      MQTT_WS_URL: 'wss://broker.example/mqtt',
      MQTT_USERNAME: 'u',
      MQTT_PASSWORD: 'p',
      MQTT_CLIENT_ID_PREFIX: 'test',
      JWT_SECRET: 'jwt',
    } as any)

    const publishMock = vi.mocked(publishMqttOverWs)
    const publishCallsAfterFirst = publishMock.mock.calls.length

    const second = await runDueSchedules({
      DB: db as any,
      MQTT_WS_URL: 'wss://broker.example/mqtt',
      MQTT_USERNAME: 'u',
      MQTT_PASSWORD: 'p',
      MQTT_CLIENT_ID_PREFIX: 'test',
      JWT_SECRET: 'jwt',
    } as any)

    expect(first).toEqual({ processed: 1, failed: 0 })
    expect(second).toEqual({ processed: 0, failed: 0 })
    expect(publishCallsAfterFirst).toBeGreaterThan(0)
    expect(publishMock).toHaveBeenCalledTimes(publishCallsAfterFirst)
  })

  it('treats window end as exclusive so adjacent on/off schedules do not overlap', async () => {
    const plannedAt = Date.UTC(2026, 0, 1, 16, 0, 0)
    const db = new SchedulerDbMock([
      {
        schedule_id: 201,
        user_id: 1,
        device_internal_id: 11,
        device_id: 'lampu-boundary',
        mqtt_device_id: 'lampu-boundary',
        command_channel: 'POWER',
        action: 'ON',
        cron_expr: '* * * * *',
        timezone: 'Asia/Jakarta',
        next_run_at: plannedAt,
        window_group_id: 'on-window',
        window_start_minute: 18 * 3600,
        window_end_minute: 23 * 3600,
        enforce_every_minute: 60,
      },
      {
        schedule_id: 202,
        user_id: 1,
        device_internal_id: 11,
        device_id: 'lampu-boundary',
        mqtt_device_id: 'lampu-boundary',
        command_channel: 'POWER',
        action: 'OFF',
        cron_expr: '* * * * *',
        timezone: 'Asia/Jakarta',
        next_run_at: plannedAt,
        window_group_id: 'off-window',
        window_start_minute: 23 * 3600,
        window_end_minute: 23 * 3600 + 30 * 60,
        enforce_every_minute: 60,
      },
    ])

    const result = await runDueSchedules({
      DB: db as any,
      MQTT_WS_URL: 'wss://broker.example/mqtt',
      MQTT_USERNAME: 'u',
      MQTT_PASSWORD: 'p',
      MQTT_CLIENT_ID_PREFIX: 'test',
      JWT_SECRET: 'jwt',
    } as any)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(publishMqttOverWs).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishMqttOverWs).mock.calls[0]?.[0]).toMatchObject({
      topic: 'cmnd/lampu-boundary/POWER',
      payload: 'OFF',
    })
  })

  it('supports per-second enforcement intervals inside a window', async () => {
    const plannedAt = Date.UTC(2026, 0, 1, 16, 0, 5)
    const db = new SchedulerDbMock([
      {
        schedule_id: 301,
        user_id: 1,
        device_internal_id: 11,
        device_id: 'lampu-seconds',
        mqtt_device_id: 'lampu-seconds',
        command_channel: 'POWER',
        action: 'OFF',
        cron_expr: '*/5 * * * * *',
        timezone: 'Asia/Jakarta',
        next_run_at: plannedAt,
        window_group_id: 'seconds-window',
        window_start_minute: 23 * 3600,
        window_end_minute: 23 * 3600 + 60,
        enforce_every_minute: 5,
      },
    ])

    const result = await runDueSchedules({
      DB: db as any,
      MQTT_WS_URL: 'wss://broker.example/mqtt',
      MQTT_USERNAME: 'u',
      MQTT_PASSWORD: 'p',
      MQTT_CLIENT_ID_PREFIX: 'test',
      JWT_SECRET: 'jwt',
    } as any)

    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(publishMqttOverWs).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishMqttOverWs).mock.calls[0]?.[0]).toMatchObject({
      topic: 'cmnd/lampu-seconds/POWER',
      payload: 'OFF',
    })
  })

  it('skips seconds that do not match the enforcement interval', async () => {
    const plannedAt = Date.UTC(2026, 0, 1, 16, 0, 6)
    const db = new SchedulerDbMock([
      {
        schedule_id: 302,
        user_id: 1,
        device_internal_id: 11,
        device_id: 'lampu-seconds-skip',
        mqtt_device_id: 'lampu-seconds-skip',
        command_channel: 'POWER',
        action: 'OFF',
        cron_expr: '*/5 * * * * *',
        timezone: 'Asia/Jakarta',
        next_run_at: plannedAt,
        window_group_id: 'seconds-window',
        window_start_minute: 23 * 3600,
        window_end_minute: 23 * 3600 + 60,
        enforce_every_minute: 5,
      },
    ])

    const result = await runDueSchedules({
      DB: db as any,
      MQTT_WS_URL: 'wss://broker.example/mqtt',
      MQTT_USERNAME: 'u',
      MQTT_PASSWORD: 'p',
      MQTT_CLIENT_ID_PREFIX: 'test',
      JWT_SECRET: 'jwt',
    } as any)

    expect(result).toEqual({ processed: 0, failed: 0 })
    expect(publishMqttOverWs).not.toHaveBeenCalled()
  })
})

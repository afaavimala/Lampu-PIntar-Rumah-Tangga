import { describe, expect, it } from 'vitest'
import { computeNextRunAt } from '../src/lib/schedules'

describe('schedule next run', () => {
  it('computes next run in the future', () => {
    const now = new Date('2026-02-16T10:00:00.000Z')
    const nextRun = computeNextRunAt({
      cron: '*/5 * * * *',
      timezone: 'Asia/Jakarta',
      fromDate: now,
    })

    expect(nextRun).toBeGreaterThan(now.getTime())
  })

  it('throws for invalid timezone', () => {
    expect(() =>
      computeNextRunAt({
        cron: '*/5 * * * *',
        timezone: 'Mars/Olympus',
      }),
    ).toThrowError('SCHEDULE_INVALID_TIMEZONE')
  })
})

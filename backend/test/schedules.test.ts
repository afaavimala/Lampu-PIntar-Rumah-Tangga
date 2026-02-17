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

  it('keeps local run hour stable across DST transition', () => {
    const timezone = 'America/New_York'
    const firstWindow = new Date('2025-03-08T12:30:00.000Z')
    const firstRun = computeNextRunAt({
      cron: '0 8 * * *',
      timezone,
      fromDate: firstWindow,
    })

    const secondWindow = new Date(firstRun + 60 * 60 * 1000)
    const secondRun = computeNextRunAt({
      cron: '0 8 * * *',
      timezone,
      fromDate: secondWindow,
    })

    const toLocalHour = (ts: number) =>
      Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: '2-digit',
          hour12: false,
        }).format(new Date(ts)),
      )

    expect(toLocalHour(firstRun)).toBe(8)
    expect(toLocalHour(secondRun)).toBe(8)
  })
})

import { CronExpressionParser } from 'cron-parser'
import { isValidTimezone } from './crypto'

export function computeNextRunAt(input: {
  cron: string
  timezone: string
  fromDate?: Date
}) {
  if (!isValidTimezone(input.timezone)) {
    throw new Error('SCHEDULE_INVALID_TIMEZONE')
  }

  let parser
  try {
    parser = CronExpressionParser.parse(input.cron, {
      currentDate: input.fromDate ?? new Date(),
      tz: input.timezone,
    })
  } catch {
    throw new Error('SCHEDULE_INVALID_CRON')
  }

  return parser.next().toDate().getTime()
}

export function normalizePlannedAt(now = Date.now()) {
  return Math.floor(now / 60_000) * 60_000
}

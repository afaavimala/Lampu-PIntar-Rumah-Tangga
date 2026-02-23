import { useMemo, useState } from 'react'
import type { Device, ScheduleRule, ScheduleRun } from '../lib/types'

type WeekdayKey = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'

type SchedulePatchInput = Partial<{
  action: 'ON' | 'OFF'
  cron: string
  timezone: string
  enabled: boolean
  startAt: string | null
  endAt: string | null
  windowGroupId: string | null
  windowStartMinute: number | null
  windowEndMinute: number | null
  enforceEveryMinute: number | null
}>

type ScheduleManagerProps = {
  devices: Device[]
  schedules: ScheduleRule[]
  selectedScheduleId: number | null
  scheduleRuns: ScheduleRun[]
  onSelectSchedule: (scheduleId: number) => Promise<void>
  onCreate: (input: {
    deviceId: string
    timezone: string
    enforcementCron: string
    activeAction: 'ON' | 'OFF'
    windowGroupId: string
    windowStartMinute: number
    windowEndMinute: number
    enforceEveryMinute: number
  }) => Promise<void>
  onToggleEnabled: (schedule: ScheduleRule) => Promise<void>
  onDelete: (scheduleId: number) => Promise<void>
  onUpdate: (scheduleId: number, patch: SchedulePatchInput) => Promise<void>
  busy?: boolean
}

type ParsedCron = {
  time: string
  days: WeekdayKey[]
}

type ScheduleWindow = {
  key: string
  deviceId: string
  timezone: string
  days: WeekdayKey[]
  action: 'ON' | 'OFF'
  fromTime: string
  untilTime: string
  intervalMinutes: number
  nextRunAt: number | null
  rules: ScheduleRule[]
  groupId: string | null
  legacy: boolean
}

const WEEKDAYS: Array<{ key: WeekdayKey; short: string; cron: number }> = [
  { key: 'MON', short: 'Sen', cron: 1 },
  { key: 'TUE', short: 'Sel', cron: 2 },
  { key: 'WED', short: 'Rab', cron: 3 },
  { key: 'THU', short: 'Kam', cron: 4 },
  { key: 'FRI', short: 'Jum', cron: 5 },
  { key: 'SAT', short: 'Sab', cron: 6 },
  { key: 'SUN', short: 'Min', cron: 0 },
]

const ALL_DAYS = WEEKDAYS.map((item) => item.key)
const LEGACY_DAILY_CRON_PATTERN = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-9,*]+)\s*$/
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function toPaddedTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function minuteToTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return toPaddedTime(hour, minute)
}

function timeToMinute(time: string) {
  const match = TIME_24H_PATTERN.exec(time)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function normalizeDayOrder(days: WeekdayKey[]) {
  const selected = new Set(days)
  return WEEKDAYS.filter((item) => selected.has(item.key)).map((item) => item.key)
}

function toggleDay(days: WeekdayKey[], day: WeekdayKey) {
  return normalizeDayOrder(days.includes(day) ? days.filter((item) => item !== day) : [...days, day])
}

function normalizeTimeInput(raw: string) {
  const digitsOnly = raw.replace(/\D/g, '').slice(0, 4)
  if (digitsOnly.length <= 2) {
    return digitsOnly
  }
  return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2)}`
}

function normalizeIntervalInput(raw: string) {
  return raw.replace(/\D/g, '').slice(0, 4)
}

function isValidTime24(value: string) {
  return TIME_24H_PATTERN.test(value)
}

function isValidIntervalMinutes(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 1440
}

function buildCronDaySegment(days: WeekdayKey[]) {
  const orderedDays = normalizeDayOrder(days)
  if (orderedDays.length === 7) {
    return '*'
  }
  return orderedDays
    .map((key) => WEEKDAYS.find((item) => item.key === key)?.cron)
    .filter((value): value is number => typeof value === 'number')
    .join(',')
}

function buildEnforcementCron(days: WeekdayKey[]) {
  return `* * * * ${buildCronDaySegment(days)}`
}

function dayTokenToKey(token: string): WeekdayKey | null {
  const numeric = Number(token)
  if (!Number.isInteger(numeric)) return null
  if (numeric === 0 || numeric === 7) return 'SUN'
  if (numeric === 1) return 'MON'
  if (numeric === 2) return 'TUE'
  if (numeric === 3) return 'WED'
  if (numeric === 4) return 'THU'
  if (numeric === 5) return 'FRI'
  if (numeric === 6) return 'SAT'
  return null
}

function parseDaysFromCron(cron: string): WeekdayKey[] | null {
  const segments = cron.trim().split(/\s+/)
  if (segments.length !== 5) {
    return null
  }
  const daySegment = segments[4].trim()
  if (daySegment === '*') {
    return [...ALL_DAYS]
  }

  const parsedDays = daySegment
    .split(',')
    .map((token) => dayTokenToKey(token.trim()))
    .filter((value): value is WeekdayKey => value != null)

  if (parsedDays.length === 0) {
    return null
  }
  return normalizeDayOrder(parsedDays)
}

function parseLegacyCron(cron: string): ParsedCron | null {
  const match = LEGACY_DAILY_CRON_PATTERN.exec(cron)
  if (!match) {
    return null
  }

  const minute = Number(match[1])
  const hour = Number(match[2])
  const days = parseDaysFromCron(cron)
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!days) return null

  return {
    time: toPaddedTime(hour, minute),
    days,
  }
}

function fallbackTimeFromNextRun(schedule: ScheduleRule) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: schedule.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(schedule.nextRunAt))
    const hour = parts.find((part) => part.type === 'hour')?.value
    const minute = parts.find((part) => part.type === 'minute')?.value
    if (hour && minute) {
      return `${hour}:${minute}`
    }
  } catch {
    // fallback below
  }

  const date = new Date(schedule.nextRunAt)
  return toPaddedTime(date.getHours(), date.getMinutes())
}

function describeDays(days: WeekdayKey[]) {
  if (days.length === 7) {
    return 'Setiap hari'
  }

  const shortByKey = new Map(WEEKDAYS.map((item) => [item.key, item.short]))
  return days.map((key) => shortByKey.get(key) ?? key).join(', ')
}

function formatEpoch24(epochMs: number) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(epochMs))
}

type Time24InputProps = {
  label: string
  value: string
  disabled: boolean
  onChange: (nextValue: string) => void
}

function Time24Input({ label, value, disabled, onChange }: Time24InputProps) {
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH:mm"
        pattern={TIME_24H_PATTERN.source}
        title="Gunakan format 24 jam HH:mm"
        value={value}
        onChange={(event) => onChange(normalizeTimeInput(event.target.value))}
        required
        disabled={disabled}
      />
    </label>
  )
}

type ActionInputProps = {
  label: string
  value: 'ON' | 'OFF'
  disabled: boolean
  onChange: (nextValue: 'ON' | 'OFF') => void
}

function ActionInput({ label, value, disabled, onChange }: ActionInputProps) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as 'ON' | 'OFF')} disabled={disabled}>
        <option value="ON">ON</option>
        <option value="OFF">OFF</option>
      </select>
    </label>
  )
}

type IntervalInputProps = {
  label: string
  value: number
  disabled: boolean
  onChange: (nextValue: number) => void
}

function IntervalInput({ label, value, disabled, onChange }: IntervalInputProps) {
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="contoh: 10"
        value={String(value)}
        onChange={(event) => {
          const normalized = normalizeIntervalInput(event.target.value)
          onChange(normalized ? Number(normalized) : 0)
        }}
        required
        disabled={disabled}
      />
    </label>
  )
}

type WeekdayToggleGroupProps = {
  value: WeekdayKey[]
  disabled: boolean
  onToggle: (day: WeekdayKey) => void
}

function WeekdayToggleGroup({ value, disabled, onToggle }: WeekdayToggleGroupProps) {
  return (
    <div className="weekday-grid">
      {WEEKDAYS.map((day) => {
        const active = value.includes(day.key)
        return (
          <button
            key={day.key}
            type="button"
            className={`weekday-toggle ${active ? 'is-enabled' : 'is-disabled'}`}
            aria-pressed={active}
            onClick={() => onToggle(day.key)}
            disabled={disabled}
          >
            {day.short}
          </button>
        )
      })}
    </div>
  )
}

export function ScheduleManager({
  devices,
  schedules,
  selectedScheduleId,
  scheduleRuns,
  onSelectSchedule,
  onCreate,
  onToggleEnabled,
  onDelete,
  onUpdate,
  busy = false,
}: ScheduleManagerProps) {
  const [deviceIdInput, setDeviceIdInput] = useState('')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [activeDays, setActiveDays] = useState<WeekdayKey[]>([...ALL_DAYS])
  const [timeFrom, setTimeFrom] = useState('18:00')
  const [timeUntil, setTimeUntil] = useState('23:00')
  const [activeAction, setActiveAction] = useState<'ON' | 'OFF'>('ON')
  const [enforceEveryMinute, setEnforceEveryMinute] = useState(10)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editTimezone, setEditTimezone] = useState('Asia/Jakarta')
  const [editDays, setEditDays] = useState<WeekdayKey[]>([...ALL_DAYS])
  const [editTimeFrom, setEditTimeFrom] = useState('18:00')
  const [editTimeUntil, setEditTimeUntil] = useState('23:00')
  const [editActiveAction, setEditActiveAction] = useState<'ON' | 'OFF'>('ON')
  const [editEnforceEveryMinute, setEditEnforceEveryMinute] = useState(10)
  const [editingLegacy, setEditingLegacy] = useState(false)

  const hasDevices = devices.length > 0
  const deviceNameById = useMemo(() => new Map(devices.map((item) => [item.id, item.name])), [devices])

  const selectedDeviceId = useMemo(() => {
    if (devices.length === 0) {
      return ''
    }
    if (deviceIdInput && devices.some((item) => item.id === deviceIdInput)) {
      return deviceIdInput
    }
    return devices[0].id
  }, [devices, deviceIdInput])

  const windows = useMemo<ScheduleWindow[]>(() => {
    const grouped = new Map<string, ScheduleWindow>()
    const legacy: ScheduleWindow[] = []

    for (const rule of schedules) {
      const hasWindowConfig =
        rule.windowStartMinute != null &&
        rule.windowEndMinute != null &&
        rule.enforceEveryMinute != null &&
        rule.windowGroupId != null

      if (hasWindowConfig) {
        const groupId = String(rule.windowGroupId)
        const key = `group:${groupId}`
        const days = parseDaysFromCron(rule.cron) ?? [...ALL_DAYS]
        const found = grouped.get(key)
        if (!found) {
          grouped.set(key, {
            key,
            deviceId: rule.deviceId,
            timezone: rule.timezone,
            days,
            action: rule.action,
            fromTime: minuteToTime(Number(rule.windowStartMinute)),
            untilTime: minuteToTime(Number(rule.windowEndMinute)),
            intervalMinutes: Number(rule.enforceEveryMinute),
            nextRunAt: rule.nextRunAt,
            rules: [rule],
            groupId,
            legacy: false,
          })
        } else {
          found.rules.push(rule)
          if (rule.nextRunAt < (found.nextRunAt ?? Number.MAX_SAFE_INTEGER)) {
            found.nextRunAt = rule.nextRunAt
          }
        }
        continue
      }

      const parsed = parseLegacyCron(rule.cron)
      if (parsed) {
        legacy.push({
          key: `legacy:${rule.id}`,
          deviceId: rule.deviceId,
          timezone: rule.timezone,
          days: parsed.days,
          action: rule.action,
          fromTime: parsed.time,
          untilTime: parsed.time,
          intervalMinutes: 0,
          nextRunAt: rule.nextRunAt,
          rules: [rule],
          groupId: null,
          legacy: true,
        })
      } else {
        const fallback = fallbackTimeFromNextRun(rule)
        legacy.push({
          key: `legacy:${rule.id}`,
          deviceId: rule.deviceId,
          timezone: rule.timezone,
          days: [...ALL_DAYS],
          action: rule.action,
          fromTime: fallback,
          untilTime: fallback,
          intervalMinutes: 0,
          nextRunAt: rule.nextRunAt,
          rules: [rule],
          groupId: null,
          legacy: true,
        })
      }
    }

    const result = [...grouped.values(), ...legacy]
    return result.sort((a, b) => {
      const aNext = a.nextRunAt ?? Number.MAX_SAFE_INTEGER
      const bNext = b.nextRunAt ?? Number.MAX_SAFE_INTEGER
      if (aNext !== bNext) {
        return aNext - bNext
      }
      return a.key.localeCompare(b.key)
    })
  }, [schedules])

  const editingWindow = useMemo(() => windows.find((window) => window.key === editingKey) ?? null, [windows, editingKey])

  return (
    <section className="schedule-shell">
      <div className="schedule-create">
        <h3>Buat Jadwal Lampu</h3>
        <p className="small">
          Pilih hari, rentang waktu aktif, kondisi lampu, lalu interval enforcement agar eksekusi tetap terjaga.
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (
              !selectedDeviceId ||
              activeDays.length === 0 ||
              !isValidTime24(timeFrom) ||
              !isValidTime24(timeUntil) ||
              !isValidIntervalMinutes(enforceEveryMinute)
            ) {
              return
            }

            const startMinute = timeToMinute(timeFrom)
            const endMinute = timeToMinute(timeUntil)
            if (startMinute == null || endMinute == null) return

            await onCreate({
              deviceId: selectedDeviceId,
              timezone,
              enforcementCron: buildEnforcementCron(activeDays),
              activeAction,
              windowGroupId: crypto.randomUUID(),
              windowStartMinute: startMinute,
              windowEndMinute: endMinute,
              enforceEveryMinute,
            })
          }}
          className="schedule-form"
        >
          <label>
            Device
            <select
              value={selectedDeviceId}
              onChange={(event) => setDeviceIdInput(event.target.value)}
              required
              disabled={busy}
            >
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="weekday-picker" disabled={busy}>
            <legend>Hari Aktif</legend>
            <WeekdayToggleGroup
              value={activeDays}
              disabled={busy}
              onToggle={(day) => setActiveDays((prev) => toggleDay(prev, day))}
            />
          </fieldset>

          <Time24Input label="Waktu Dari (24 jam)" value={timeFrom} onChange={setTimeFrom} disabled={busy} />
          <Time24Input label="Waktu Sampai (24 jam)" value={timeUntil} onChange={setTimeUntil} disabled={busy} />
          <ActionInput label="Kondisi Saat Rentang Aktif" value={activeAction} onChange={setActiveAction} disabled={busy} />
          <IntervalInput
            label="Interval Eksekusi (menit)"
            value={enforceEveryMinute}
            onChange={setEnforceEveryMinute}
            disabled={busy}
          />

          <label>
            Timezone
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required disabled={busy} />
          </label>

          {!hasDevices ? <p className="small">Tambahkan device terlebih dahulu sebelum membuat jadwal.</p> : null}
          <button
            type="submit"
            disabled={
              !hasDevices ||
              busy ||
              activeDays.length === 0 ||
              !isValidTime24(timeFrom) ||
              !isValidTime24(timeUntil) ||
              !isValidIntervalMinutes(enforceEveryMinute)
            }
          >
            {busy ? 'Memproses...' : 'Create Schedule'}
          </button>
        </form>
      </div>

      <div className="schedule-list">
        <h3>Daftar Jadwal Lampu</h3>
        <p className="small">Di luar rentang waktu, kondisi lampu tidak dipaksa berubah oleh jadwal.</p>
        {windows.length === 0 ? <p>Belum ada jadwal.</p> : null}
        <ul>
          {windows.map((window) => {
            const allEnabled = window.rules.length > 0 && window.rules.every((rule) => rule.enabled)
            const primaryRuleId = window.rules[0]?.id ?? null
            const isSelected =
              selectedScheduleId != null && window.rules.some((rule) => rule.id === selectedScheduleId)

            return (
              <li key={window.key} className={isSelected ? 'selected' : ''}>
                {editingKey === window.key && editingWindow ? (
                  <form
                    className="schedule-edit-form"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      if (
                        editDays.length === 0 ||
                        !isValidTime24(editTimeFrom) ||
                        !isValidTime24(editTimeUntil) ||
                        !isValidIntervalMinutes(editEnforceEveryMinute)
                      ) {
                        return
                      }

                      const startMinute = timeToMinute(editTimeFrom)
                      const endMinute = timeToMinute(editTimeUntil)
                      if (startMinute == null || endMinute == null) {
                        return
                      }

                      const patch: SchedulePatchInput = {
                        action: editActiveAction,
                        cron: buildEnforcementCron(editDays),
                        timezone: editTimezone,
                        windowGroupId: editingWindow.groupId ?? crypto.randomUUID(),
                        windowStartMinute: startMinute,
                        windowEndMinute: endMinute,
                        enforceEveryMinute: editEnforceEveryMinute,
                      }

                      for (const rule of editingWindow.rules) {
                        await onUpdate(rule.id, patch)
                      }
                      setEditingKey(null)
                    }}
                  >
                    <fieldset className="weekday-picker" disabled={busy}>
                      <legend>Hari Aktif</legend>
                      <WeekdayToggleGroup
                        value={editDays}
                        disabled={busy}
                        onToggle={(day) => setEditDays((prev) => toggleDay(prev, day))}
                      />
                    </fieldset>

                    <Time24Input label="Waktu Dari (24 jam)" value={editTimeFrom} onChange={setEditTimeFrom} disabled={busy} />
                    <Time24Input label="Waktu Sampai (24 jam)" value={editTimeUntil} onChange={setEditTimeUntil} disabled={busy} />
                    <ActionInput
                      label="Kondisi Saat Rentang Aktif"
                      value={editActiveAction}
                      onChange={setEditActiveAction}
                      disabled={busy}
                    />
                    <IntervalInput
                      label="Interval Eksekusi (menit)"
                      value={editEnforceEveryMinute}
                      onChange={setEditEnforceEveryMinute}
                      disabled={busy}
                    />

                    <label>
                      Timezone
                      <input value={editTimezone} onChange={(event) => setEditTimezone(event.target.value)} required disabled={busy} />
                    </label>

                    {editingLegacy ? (
                      <p className="small">
                        Jadwal lama akan dikonversi ke mode enforcement rentang waktu + interval saat disimpan.
                      </p>
                    ) : null}

                    <div className="schedule-actions">
                      <button
                        type="submit"
                        disabled={
                          busy ||
                          editDays.length === 0 ||
                          !isValidTime24(editTimeFrom) ||
                          !isValidTime24(editTimeUntil) ||
                          !isValidIntervalMinutes(editEnforceEveryMinute)
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="off"
                        disabled={busy}
                        onClick={() => {
                          setEditingKey(null)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <strong>{deviceNameById.get(window.deviceId) ?? window.deviceId}</strong> ({window.deviceId})
                    <p className="small">
                      Hari: {describeDays(window.days)} | Rentang: {window.fromTime} - {window.untilTime} | Kondisi:{' '}
                      {window.action} | Interval: {window.intervalMinutes > 0 ? `${window.intervalMinutes} menit` : 'legacy'} | TZ:{' '}
                      {window.timezone}
                    </p>
                    <p className="small">
                      Next: {window.nextRunAt != null ? formatEpoch24(window.nextRunAt) : '-'}
                      {window.legacy ? ' | mode: legacy/custom' : ''}
                    </p>
                  </div>
                )}

                <div className="schedule-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (primaryRuleId != null) {
                        void onSelectSchedule(primaryRuleId)
                      }
                    }}
                    disabled={busy || primaryRuleId == null}
                  >
                    Runs
                  </button>
                  <button
                    type="button"
                    disabled={busy || window.rules.length === 0}
                    onClick={() => {
                      setEditingKey(window.key)
                      setEditTimezone(window.timezone)
                      setEditDays(window.days)
                      setEditTimeFrom(window.fromTime)
                      setEditTimeUntil(window.untilTime)
                      setEditActiveAction(window.action)
                      setEditEnforceEveryMinute(window.intervalMinutes > 0 ? window.intervalMinutes : 10)
                      setEditingLegacy(window.legacy)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      for (const rule of window.rules) {
                        await onToggleEnabled(rule)
                      }
                    }}
                    disabled={busy || window.rules.length === 0}
                  >
                    {allEnabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      for (const rule of window.rules) {
                        await onDelete(rule.id)
                      }
                    }}
                    disabled={busy || window.rules.length === 0}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="schedule-runs">
        <h3>Riwayat Eksekusi</h3>
        {!selectedScheduleId ? <p>Pilih jadwal untuk melihat run history.</p> : null}
        {selectedScheduleId ? (
          <ul>
            {scheduleRuns.map((run) => (
              <li key={run.id}>
                <strong>{run.status}</strong> | planned: {formatEpoch24(run.plannedAt)} | executed:{' '}
                {run.executedAt ? formatEpoch24(run.executedAt) : '-'}
                {run.reason ? <p className="error">{run.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

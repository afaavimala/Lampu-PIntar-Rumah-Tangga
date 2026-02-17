import { useEffect, useMemo, useState } from 'react'
import type { Device, ScheduleRule, ScheduleRun } from '../lib/types'

type ScheduleManagerProps = {
  devices: Device[]
  schedules: ScheduleRule[]
  selectedScheduleId: number | null
  scheduleRuns: ScheduleRun[]
  onSelectSchedule: (scheduleId: number) => Promise<void>
  onCreate: (input: {
    deviceId: string
    action: 'ON' | 'OFF'
    cron: string
    timezone: string
    enabled: boolean
  }) => Promise<void>
  onToggleEnabled: (schedule: ScheduleRule) => Promise<void>
  onDelete: (scheduleId: number) => Promise<void>
  onUpdate: (
    scheduleId: number,
    patch: Partial<Pick<ScheduleRule, 'action' | 'cron' | 'timezone' | 'enabled'>>,
  ) => Promise<void>
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
}: ScheduleManagerProps) {
  const DAILY_CRON_PATTERN = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*\s*$/

  const toPaddedTime = (hour: number, minute: number) =>
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  const cronToDailyTime = (cron: string) => {
    const match = DAILY_CRON_PATTERN.exec(cron)
    if (!match) {
      return null
    }
    const minute = Number(match[1])
    const hour = Number(match[2])
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      return null
    }
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return null
    }
    return toPaddedTime(hour, minute)
  }

  const dailyTimeToCron = (time: string) => {
    const [hourText, minuteText] = time.split(':')
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const safeHour = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 18
    const safeMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0
    return `${safeMinute} ${safeHour} * * *`
  }

  const fallbackTimeFromNextRun = (schedule: ScheduleRule) => {
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

  const describeScheduleTime = (schedule: ScheduleRule) => {
    const parsed = cronToDailyTime(schedule.cron)
    if (parsed) {
      return `Setiap hari ${parsed}`
    }
    const fallback = fallbackTimeFromNextRun(schedule)
    return `Jadwal kustom (ditampilkan sebagai ${fallback})`
  }

  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '')
  const [action, setAction] = useState<'ON' | 'OFF'>('ON')
  const [time, setTime] = useState('18:00')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editAction, setEditAction] = useState<'ON' | 'OFF'>('ON')
  const [editTime, setEditTime] = useState('18:00')
  const [editTimezone, setEditTimezone] = useState('Asia/Jakarta')
  const [editingCustomCron, setEditingCustomCron] = useState(false)

  const hasDevices = devices.length > 0
  const deviceNameById = useMemo(() => new Map(devices.map((item) => [item.id, item.name])), [devices])

  useEffect(() => {
    if (devices.length === 0) {
      setDeviceId('')
      return
    }

    const stillExists = devices.some((item) => item.id === deviceId)
    if (!stillExists) {
      setDeviceId(devices[0].id)
    }
  }, [devices, deviceId])

  return (
    <section className="schedule-shell">
      <div className="schedule-create">
        <h3>Buat Jadwal Otomatis</h3>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!deviceId) return
            await onCreate({ deviceId, action, cron: dailyTimeToCron(time), timezone, enabled: true })
          }}
          className="schedule-form"
        >
          <label>
            Device
            <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} required>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select value={action} onChange={(event) => setAction(event.target.value as 'ON' | 'OFF')}>
              <option value="ON">ON</option>
              <option value="OFF">OFF</option>
            </select>
          </label>
          <label>
            Waktu (HH:mm)
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          </label>
          <label>
            Timezone
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
          </label>
          {!hasDevices ? <p className="small">Tambahkan device terlebih dahulu sebelum membuat jadwal.</p> : null}
          <button type="submit" disabled={!hasDevices}>
            Create Schedule
          </button>
        </form>
      </div>

      <div className="schedule-list">
        <h3>Daftar Jadwal</h3>
        {schedules.length === 0 ? <p>Belum ada jadwal.</p> : null}
        <ul>
          {schedules.map((schedule) => (
            <li key={schedule.id} className={selectedScheduleId === schedule.id ? 'selected' : ''}>
              {editingId === schedule.id ? (
                <form
                  className="schedule-edit-form"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    await onUpdate(schedule.id, {
                      action: editAction,
                      cron: dailyTimeToCron(editTime),
                      timezone: editTimezone,
                    })
                    setEditingId(null)
                  }}
                >
                  <label>
                    Action
                    <select value={editAction} onChange={(event) => setEditAction(event.target.value as 'ON' | 'OFF')}>
                      <option value="ON">ON</option>
                      <option value="OFF">OFF</option>
                    </select>
                  </label>
                  <label>
                    Waktu (HH:mm)
                    <input
                      type="time"
                      value={editTime}
                      onChange={(event) => setEditTime(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Timezone
                    <input value={editTimezone} onChange={(event) => setEditTimezone(event.target.value)} required />
                  </label>
                  {editingCustomCron ? (
                    <p className="small">
                      Jadwal sebelumnya adalah cron kustom. Saat disimpan, jadwal akan diubah ke mode harian sesuai
                      waktu di atas.
                    </p>
                  ) : null}
                  <div className="schedule-actions">
                    <button type="submit">Save</button>
                    <button
                      type="button"
                      className="off"
                      onClick={() => {
                        setEditingId(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div>
                  <strong>{deviceNameById.get(schedule.deviceId) ?? schedule.deviceId}</strong> ({schedule.deviceId}) -{' '}
                  {schedule.action}
                  <p className="small">
                    {describeScheduleTime(schedule)} | TZ: {schedule.timezone} | Next:{' '}
                    {new Date(schedule.nextRunAt).toLocaleString()}
                  </p>
                </div>
              )}
              <div className="schedule-actions">
                <button onClick={() => onSelectSchedule(schedule.id)}>Runs</button>
                <button
                  onClick={() => {
                    const parsedTime = cronToDailyTime(schedule.cron)
                    setEditingId(schedule.id)
                    setEditAction(schedule.action)
                    setEditTime(parsedTime ?? fallbackTimeFromNextRun(schedule))
                    setEditTimezone(schedule.timezone)
                    setEditingCustomCron(parsedTime == null)
                  }}
                >
                  Edit
                </button>
                <button onClick={() => onToggleEnabled(schedule)}>
                  {schedule.enabled ? 'Pause' : 'Resume'}
                </button>
                <button className="danger" onClick={() => onDelete(schedule.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="schedule-runs">
        <h3>Riwayat Eksekusi</h3>
        {!selectedScheduleId ? <p>Pilih jadwal untuk melihat run history.</p> : null}
        {selectedScheduleId ? (
          <ul>
            {scheduleRuns.map((run) => (
              <li key={run.id}>
                <strong>{run.status}</strong> | planned: {new Date(run.plannedAt).toLocaleString()} | executed:{' '}
                {run.executedAt ? new Date(run.executedAt).toLocaleString() : '-'}
                {run.reason ? <p className="error">{run.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}

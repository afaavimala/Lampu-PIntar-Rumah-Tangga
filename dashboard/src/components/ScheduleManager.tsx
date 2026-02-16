import { useState } from 'react'
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
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? '')
  const [action, setAction] = useState<'ON' | 'OFF'>('ON')
  const [cron, setCron] = useState('0 18 * * *')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editAction, setEditAction] = useState<'ON' | 'OFF'>('ON')
  const [editCron, setEditCron] = useState('0 18 * * *')
  const [editTimezone, setEditTimezone] = useState('Asia/Jakarta')

  return (
    <section className="schedule-shell">
      <div className="schedule-create">
        <h3>Buat Jadwal Otomatis</h3>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (!deviceId) return
            await onCreate({ deviceId, action, cron, timezone, enabled: true })
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
            Cron
            <input value={cron} onChange={(event) => setCron(event.target.value)} required />
          </label>
          <label>
            Timezone
            <input value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
          </label>
          <button type="submit">Create Schedule</button>
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
                      cron: editCron,
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
                    Cron
                    <input value={editCron} onChange={(event) => setEditCron(event.target.value)} required />
                  </label>
                  <label>
                    Timezone
                    <input value={editTimezone} onChange={(event) => setEditTimezone(event.target.value)} required />
                  </label>
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
                  <strong>{schedule.deviceId}</strong> - {schedule.action} - {schedule.cron}
                  <p className="small">
                    TZ: {schedule.timezone} | Next: {new Date(schedule.nextRunAt).toLocaleString()}
                  </p>
                </div>
              )}
              <div className="schedule-actions">
                <button onClick={() => onSelectSchedule(schedule.id)}>Runs</button>
                <button
                  onClick={() => {
                    setEditingId(schedule.id)
                    setEditAction(schedule.action)
                    setEditCron(schedule.cron)
                    setEditTimezone(schedule.timezone)
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

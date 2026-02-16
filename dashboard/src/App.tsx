import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  bootstrap,
  createSchedule,
  deleteSchedule,
  getFallbackStatus,
  listScheduleRuns,
  listSchedules,
  login,
  logout,
  patchSchedule,
  signCommand,
} from './lib/api'
import { createRealtimeClient, type RealtimeClient } from './lib/mqtt'
import type { BootstrapResponse, Device, ScheduleRule, ScheduleRun } from './lib/types'
import { DeviceCard, type DeviceState } from './components/DeviceCard'
import { LoginForm } from './components/LoginForm'
import { ScheduleManager } from './components/ScheduleManager'

type DeviceStateMap = Record<string, DeviceState>

function mergeFallbackStatuses(devices: Device[], statuses: Awaited<ReturnType<typeof getFallbackStatus>>) {
  const map: DeviceStateMap = {}
  for (const device of devices) {
    const found = statuses.find((status) => status.deviceId === device.id)
    map[device.id] = {
      power: found?.power ?? 'UNKNOWN',
      updatedAt: found?.updatedAt ?? null,
      online: false,
    }
  }
  return map
}

export default function App() {
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceState, setDeviceState] = useState<DeviceStateMap>({})
  const [schedules, setSchedules] = useState<ScheduleRule[]>([])
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null)
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRun[]>([])

  const mqttRef = useRef<RealtimeClient | null>(null)

  const isLoggedIn = initialized && hasSession

  async function hydrateDashboard(boot?: BootstrapResponse) {
    setGlobalError(null)
    const bootstrapData = boot ?? (await bootstrap())
    setHasSession(true)
    setDevices(bootstrapData.devices)

    const statuses = await getFallbackStatus()
    setDeviceState(mergeFallbackStatuses(bootstrapData.devices, statuses))

    const scheduleData = await listSchedules()
    setSchedules(scheduleData)

    if (mqttRef.current) {
      mqttRef.current.resubscribe(bootstrapData.devices.map((device) => device.id))
      return
    }

    if (!bootstrapData.mqtt?.wsUrl) {
      setGlobalError('MQTT WSS URL belum dikonfigurasi. Realtime tidak aktif.')
      return
    }

    mqttRef.current = createRealtimeClient(bootstrapData.mqtt, bootstrapData.devices.map((device) => device.id), {
      onStatus: (deviceId, payload) => {
        setDeviceState((prev) => {
          const previous = prev[deviceId] ?? {
            power: 'UNKNOWN',
            updatedAt: null,
            online: true,
          }

          const nextPower = typeof payload.power === 'string' ? payload.power : previous.power
          const nextTs =
            typeof payload.ts === 'number'
              ? new Date(payload.ts).toISOString()
              : typeof payload.updatedAt === 'string'
                ? payload.updatedAt
                : new Date().toISOString()

          return {
            ...prev,
            [deviceId]: {
              power: nextPower,
              updatedAt: nextTs,
              online: true,
            },
          }
        })
      },
      onLwt: (deviceId, payload) => {
        setDeviceState((prev) => ({
          ...prev,
          [deviceId]: {
            ...(prev[deviceId] ?? {
              power: 'UNKNOWN',
              updatedAt: null,
              online: false,
            }),
            online: payload.trim().toUpperCase() === 'ONLINE',
          },
        }))
      },
      onError: (error) => {
        setGlobalError(`MQTT error: ${error.message}`)
      },
    })
  }

  useEffect(() => {
    let mounted = true

    ;(async () => {
      setLoading(true)
      try {
        await hydrateDashboard()
      } catch {
        if (mounted) {
          setHasSession(false)
          setDevices([])
        }
      } finally {
        if (mounted) {
          setInitialized(true)
          setLoading(false)
        }
      }
    })()

    return () => {
      mounted = false
      if (mqttRef.current) {
        void mqttRef.current.disconnect()
        mqttRef.current = null
      }
    }
  }, [])

  const sortedDevices = useMemo(() => [...devices].sort((a, b) => a.name.localeCompare(b.name)), [devices])

  async function handleLogin(email: string, password: string) {
    setAuthError(null)
    setLoading(true)
    try {
      await login(email, password)
      await hydrateDashboard()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login gagal'
      setAuthError(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    setLoading(true)
    try {
      await logout()
      setDevices([])
      setHasSession(false)
      setSchedules([])
      setScheduleRuns([])
      setSelectedScheduleId(null)
      if (mqttRef.current) {
        await mqttRef.current.disconnect()
        mqttRef.current = null
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(deviceId: string, action: 'ON' | 'OFF') {
    setGlobalError(null)
    try {
      const envelope = await signCommand({
        deviceId,
        action,
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      })

      if (!mqttRef.current) {
        throw new Error('MQTT client belum terhubung')
      }

      await mqttRef.current.publishSignedCommand(envelope)
      setDeviceState((prev) => ({
        ...prev,
        [deviceId]: {
          ...(prev[deviceId] ?? {
            power: 'UNKNOWN',
            updatedAt: null,
            online: true,
          }),
          power: action,
          updatedAt: new Date().toISOString(),
          online: true,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command gagal'
      setGlobalError(message)
    }
  }

  async function refreshSchedules() {
    const nextSchedules = await listSchedules()
    setSchedules(nextSchedules)
  }

  async function handleCreateSchedule(input: {
    deviceId: string
    action: 'ON' | 'OFF'
    cron: string
    timezone: string
    enabled: boolean
  }) {
    setGlobalError(null)
    try {
      await createSchedule({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      })
      await refreshSchedules()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create schedule gagal'
      setGlobalError(message)
    }
  }

  async function handleToggleSchedule(schedule: ScheduleRule) {
    setGlobalError(null)
    try {
      await patchSchedule(
        schedule.id,
        {
          enabled: !schedule.enabled,
        },
        crypto.randomUUID(),
      )
      await refreshSchedules()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Toggle schedule gagal'
      setGlobalError(message)
    }
  }

  async function handleUpdateSchedule(
    scheduleId: number,
    patch: Partial<Pick<ScheduleRule, 'action' | 'cron' | 'timezone' | 'enabled'>>,
  ) {
    setGlobalError(null)
    try {
      await patchSchedule(scheduleId, patch, crypto.randomUUID())
      await refreshSchedules()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update schedule gagal'
      setGlobalError(message)
    }
  }

  async function handleDeleteSchedule(scheduleId: number) {
    setGlobalError(null)
    try {
      await deleteSchedule(scheduleId, crypto.randomUUID())
      await refreshSchedules()
      if (selectedScheduleId === scheduleId) {
        setSelectedScheduleId(null)
        setScheduleRuns([])
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete schedule gagal'
      setGlobalError(message)
    }
  }

  async function handleSelectSchedule(scheduleId: number) {
    setSelectedScheduleId(scheduleId)
    try {
      const runs = await listScheduleRuns(scheduleId)
      setScheduleRuns(runs)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Load schedule runs gagal'
      setGlobalError(message)
    }
  }

  if (!initialized || (!isLoggedIn && loading)) {
    return (
      <main className="loading-screen">
        <p>Memuat SmartLamp Dashboard...</p>
      </main>
    )
  }

  if (!isLoggedIn) {
    return <LoginForm loading={loading} error={authError} onLogin={handleLogin} />
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>SmartLamp IoT Dashboard</h1>
          <p>Realtime control, scheduling, dan open integration API.</p>
        </div>
        <button onClick={handleLogout} disabled={loading}>
          Logout
        </button>
      </header>

      {globalError ? <p className="error global-error">{globalError}</p> : null}

      <section className="device-grid">
        {sortedDevices.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            state={
              deviceState[device.id] ?? {
                power: 'UNKNOWN',
                updatedAt: null,
                online: false,
              }
            }
            onAction={handleAction}
          />
        ))}
      </section>

      <ScheduleManager
        devices={sortedDevices}
        schedules={schedules}
        selectedScheduleId={selectedScheduleId}
        scheduleRuns={scheduleRuns}
        onCreate={handleCreateSchedule}
        onToggleEnabled={handleToggleSchedule}
        onDelete={handleDeleteSchedule}
        onUpdate={handleUpdateSchedule}
        onSelectSchedule={handleSelectSchedule}
      />
    </main>
  )
}

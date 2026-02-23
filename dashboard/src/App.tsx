import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DeviceManager } from './components/DeviceManager'
import { LoginForm } from './components/LoginForm'
import { ScheduleManager } from './components/ScheduleManager'
import { BulbIcon, DeleteIcon, EditIcon, UserCircleIcon, WifiIcon } from './components/UiIcons'
import {
  bootstrap,
  createDevice,
  createSchedule,
  deleteDevice,
  deleteSchedule,
  discoverDevices,
  executeCommand,
  getFallbackStatus,
  listScheduleRuns,
  listSchedules,
  login,
  logout,
  patchSchedule,
  updateDevice,
} from './lib/api'
import { createRealtimeClient, type RealtimeClient } from './lib/realtime'
import type {
  BootstrapResponse,
  Device,
  DeviceStatus,
  DiscoveredDevice,
  ScheduleRule,
  ScheduleRun,
} from './lib/types'

type DeviceState = {
  power: string
  updatedAt: string | null
  online: boolean
  source: string
}

type DeviceStateMap = Record<string, DeviceState>

type LampView = {
  device: Device
  title: string
  power: 'ON' | 'OFF'
  online: boolean
  updatedAt: string | null
  source: string
}

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

function mergeFallbackStatuses(devices: Device[], statuses: DeviceStatus[]) {
  const statusByDeviceId = new Map(statuses.map((status) => [status.deviceId, status]))
  const map: DeviceStateMap = {}

  for (const device of devices) {
    const found = statusByDeviceId.get(device.id)
    map[device.id] = {
      power: found?.power ?? 'UNKNOWN',
      updatedAt: found?.updatedAt ?? null,
      online: false,
      source: found?.source ?? 'none',
    }
  }

  return map
}

function normalizePower(value: string | undefined): 'ON' | 'OFF' {
  if (value === 'ON' || value === 'OFF') {
    return value
  }
  return 'OFF'
}

function formatUptime(totalSeconds: number) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function syncDiscoveredDevicesWithOwned(discovered: DiscoveredDevice[], devices: Device[]) {
  if (discovered.length === 0) {
    return discovered
  }

  const ownedDeviceIds = new Set(devices.map((device) => device.id.toLowerCase()))
  return discovered.map((item) => {
    const linked = ownedDeviceIds.has(item.deviceId.toLowerCase())
    if (!linked) {
      return item
    }
    return {
      ...item,
      alreadyLinked: true,
      alreadyRegistered: true,
    }
  })
}

function resolveViewerLabel(viewer: BootstrapResponse['viewer']) {
  if (!viewer) {
    return 'Akun'
  }
  return viewer.kind === 'user' ? viewer.email : viewer.name
}

export default function App() {
  const [loading, setLoading] = useState(false)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [viewerLabel, setViewerLabel] = useState('Akun')
  const [authError, setAuthError] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceState, setDeviceState] = useState<DeviceStateMap>({})
  const [pendingToggleByDevice, setPendingToggleByDevice] = useState<Record<string, boolean>>({})
  const [schedules, setSchedules] = useState<ScheduleRule[]>([])
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null)
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRun[]>([])
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [discoveryScannedAt, setDiscoveryScannedAt] = useState<string | null>(null)
  const [discoveryWaitMs, setDiscoveryWaitMs] = useState<number | null>(null)
  const [claimingDeviceId, setClaimingDeviceId] = useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [deviceEditFocusNonce, setDeviceEditFocusNonce] = useState(0)
  const [uptimeSeconds, setUptimeSeconds] = useState(0)

  const realtimeRef = useRef<RealtimeClient | null>(null)
  const isLoggedIn = initialized && hasSession

  const refreshScheduleData = useCallback(async (preferredSelection: number | null) => {
    const rules = await listSchedules()
    setSchedules(rules)

    const resolvedSelection =
      preferredSelection != null && rules.some((rule) => rule.id === preferredSelection) ? preferredSelection : null

    setSelectedScheduleId(resolvedSelection)
    if (resolvedSelection == null) {
      setScheduleRuns([])
      return
    }

    const runs = await listScheduleRuns(resolvedSelection)
    setScheduleRuns(runs)
  }, [])

  const hydrateDashboard = useCallback(async (boot?: BootstrapResponse) => {
    setGlobalError(null)
    const bootstrapData = boot ?? (await bootstrap())

    if (!bootstrapData.realtime) {
      setHasSession(false)
      setViewerLabel('Akun')
      setDevices([])
      setDeviceState({})
      setDiscoveredDevices([])
      setDiscoveryScannedAt(null)
      setDiscoveryWaitMs(null)
      setClaimingDeviceId(null)
      setEditingDeviceId(null)
      setSchedules([])
      setSelectedScheduleId(null)
      setScheduleRuns([])
      if (realtimeRef.current) {
        await realtimeRef.current.disconnect()
        realtimeRef.current = null
      }
      return
    }

    setHasSession(true)
    setViewerLabel(resolveViewerLabel(bootstrapData.viewer))
    setDevices(bootstrapData.devices)
    setDiscoveredDevices((prev) => syncDiscoveredDevicesWithOwned(prev, bootstrapData.devices))

    const statuses = await getFallbackStatus()
    setDeviceState(mergeFallbackStatuses(bootstrapData.devices, statuses))

    try {
      await refreshScheduleData(null)
    } catch (error) {
      setSchedules([])
      setSelectedScheduleId(null)
      setScheduleRuns([])
      setGlobalError(`Gagal memuat jadwal: ${toErrorMessage(error, 'unknown error')}`)
    }

    if (realtimeRef.current) {
      realtimeRef.current.resubscribe(bootstrapData.devices.map((device) => device.id))
      return
    }

    realtimeRef.current = createRealtimeClient(
      bootstrapData.devices.map((device) => device.id),
      {
        onStatus: (deviceId, payload) => {
          setDeviceState((prev) => {
            const previous = prev[deviceId] ?? {
              power: 'UNKNOWN',
              updatedAt: null,
              online: false,
              source: 'none',
            }

            const nextPower = typeof payload.power === 'string' ? payload.power : previous.power
            const nextTs =
              typeof payload.ts === 'number'
                ? new Date(payload.ts).toISOString()
                : typeof payload.updatedAt === 'string'
                  ? payload.updatedAt
                  : new Date().toISOString()
            const nextSource = typeof payload.source === 'string' ? payload.source : previous.source

            return {
              ...prev,
              [deviceId]: {
                power: nextPower,
                updatedAt: nextTs,
                online: previous.online,
                source: nextSource,
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
                source: 'none',
              }),
              online: payload.trim().toUpperCase() === 'ONLINE',
            },
          }))
        },
        onError: (error) => {
          setGlobalError(`Realtime stream error: ${error.message}`)
        },
      },
      { streamPath: bootstrapData.realtime.streamPath },
    )
  }, [refreshScheduleData])

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
          setSchedules([])
          setSelectedScheduleId(null)
          setScheduleRuns([])
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
      if (realtimeRef.current) {
        void realtimeRef.current.disconnect()
        realtimeRef.current = null
      }
    }
  }, [hydrateDashboard])

  useEffect(() => {
    if (!isLoggedIn) {
      setUptimeSeconds(0)
      return
    }

    const startedAt = Date.now()
    setUptimeSeconds(0)
    const timerId = window.setInterval(() => {
      setUptimeSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [isLoggedIn])

  useEffect(() => {
    if (!editingDeviceId) {
      return
    }
    if (devices.some((device) => device.id === editingDeviceId)) {
      return
    }
    setEditingDeviceId(null)
  }, [devices, editingDeviceId])

  const sortedDevices = useMemo(() => [...devices].sort((a, b) => a.name.localeCompare(b.name)), [devices])
  const editingDevice = useMemo(
    () => (editingDeviceId ? devices.find((device) => device.id === editingDeviceId) ?? null : null),
    [devices, editingDeviceId],
  )

  const lamps = useMemo<LampView[]>(
    () =>
      sortedDevices.map((device, index) => {
        const state = deviceState[device.id]
        return {
          device,
          title: device.name || `Lampu ${index + 1}`,
          power: normalizePower(state?.power),
          online: state?.online ?? false,
          updatedAt: state?.updatedAt ?? null,
          source: state?.source ?? 'none',
        }
      }),
    [sortedDevices, deviceState],
  )

  const onlineDeviceCount = useMemo(() => lamps.filter((lamp) => lamp.online).length, [lamps])

  const latestDeviceUpdate = useMemo(() => {
    let latest: string | null = null
    for (const lamp of lamps) {
      if (!lamp.updatedAt) continue
      if (!latest || new Date(lamp.updatedAt).getTime() > new Date(latest).getTime()) {
        latest = lamp.updatedAt
      }
    }
    return latest
  }, [lamps])

  const isConnected = onlineDeviceCount > 0

  async function handleLogin(email: string, password: string) {
    setAuthError(null)
    setLoading(true)
    try {
      const loginResult = await login(email, password)
      setViewerLabel(loginResult.user.email)
      await hydrateDashboard()
    } catch (error) {
      setAuthError(toErrorMessage(error, 'Login gagal'))
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    setLoading(true)
    try {
      await logout()
      setDevices([])
      setDeviceState({})
      setDiscoveredDevices([])
      setDiscoveryScannedAt(null)
      setDiscoveryWaitMs(null)
      setClaimingDeviceId(null)
      setEditingDeviceId(null)
      setSchedules([])
      setSelectedScheduleId(null)
      setScheduleRuns([])
      setViewerLabel('Akun')
      setHasSession(false)
      if (realtimeRef.current) {
        await realtimeRef.current.disconnect()
        realtimeRef.current = null
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleLamp(lamp: LampView) {
    const deviceId = lamp.device.id
    if (pendingToggleByDevice[deviceId]) {
      return
    }

    const action = lamp.power === 'ON' ? 'OFF' : 'ON'
    const previousState = deviceState[deviceId] ?? {
      power: 'UNKNOWN',
      updatedAt: null,
      online: lamp.online,
      source: lamp.source,
    }

    setGlobalError(null)
    setPendingToggleByDevice((prev) => ({
      ...prev,
      [deviceId]: true,
    }))
    setDeviceState((prev) => ({
      ...prev,
      [deviceId]: {
        ...previousState,
        power: action,
        updatedAt: new Date().toISOString(),
        source: 'pending_ack',
      },
    }))

    try {
      await executeCommand({
        deviceId,
        action,
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      })
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Command gagal'))
      setDeviceState((prev) => ({
        ...prev,
        [deviceId]: previousState,
      }))
    } finally {
      setPendingToggleByDevice((prev) => {
        const next = { ...prev }
        delete next[deviceId]
        return next
      })
    }
  }

  async function handleCreateDevice(input: {
    deviceId: string
    name: string
    location?: string
    commandChannel?: string
  }) {
    setGlobalError(null)
    setDeviceBusy(true)
    try {
      await createDevice({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      })
      await hydrateDashboard()
      setEditingDeviceId(null)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal menambah device'))
    } finally {
      setDeviceBusy(false)
    }
  }

  async function handleUpdateDevice(input: {
    deviceId: string
    name: string
    location?: string
    commandChannel?: string
  }) {
    setGlobalError(null)
    setDeviceBusy(true)
    try {
      await updateDevice({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      })
      await hydrateDashboard()
      setEditingDeviceId(null)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal menyimpan perubahan device'))
    } finally {
      setDeviceBusy(false)
    }
  }

  function handleStartEditDevice(deviceId: string) {
    setEditingDeviceId(deviceId)
    setDeviceEditFocusNonce((value) => value + 1)
  }

  async function handleDeleteDevice(device: Device) {
    if (!window.confirm(`Hapus device "${device.name}" (${device.id})?`)) {
      return
    }

    setGlobalError(null)
    setDeviceBusy(true)
    try {
      await deleteDevice({
        deviceId: device.id,
        idempotencyKey: crypto.randomUUID(),
      })
      await hydrateDashboard()
      if (editingDeviceId === device.id) {
        setEditingDeviceId(null)
      }
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal menghapus device'))
    } finally {
      setDeviceBusy(false)
    }
  }

  async function handleDiscoverDevices() {
    setGlobalError(null)
    setDiscovering(true)
    try {
      const result = await discoverDevices({
        waitMs: 1_200,
        maxDevices: 200,
      })
      setDiscoveredDevices(syncDiscoveredDevicesWithOwned(result.devices, devices))
      setDiscoveryScannedAt(result.scannedAt)
      setDiscoveryWaitMs(result.waitMs)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal melakukan discovery device'))
    } finally {
      setDiscovering(false)
    }
  }

  async function handleClaimDiscoveredDevice(device: DiscoveredDevice) {
    if (device.alreadyLinked || device.alreadyRegistered) {
      return
    }

    setGlobalError(null)
    setDeviceBusy(true)
    setClaimingDeviceId(device.deviceId)
    try {
      await createDevice({
        deviceId: device.deviceId,
        name: device.suggestedName,
        idempotencyKey: crypto.randomUUID(),
      })
      await hydrateDashboard()
      setDiscoveredDevices((prev) =>
        prev.map((item) =>
          item.deviceId === device.deviceId
            ? {
                ...item,
                alreadyLinked: true,
                alreadyRegistered: true,
              }
            : item,
        ),
      )
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal menambahkan device dari hasil discovery'))
    } finally {
      setClaimingDeviceId(null)
      setDeviceBusy(false)
    }
  }

  async function handleSelectSchedule(scheduleId: number) {
    setGlobalError(null)
    setSelectedScheduleId(scheduleId)
    try {
      const runs = await listScheduleRuns(scheduleId)
      setScheduleRuns(runs)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal memuat run history'))
      setScheduleRuns([])
    }
  }

  async function handleCreateSchedule(input: {
    deviceId: string
    timezone: string
    enforcementCron: string
    activeAction: 'ON' | 'OFF'
    windowGroupId: string
    windowStartMinute: number
    windowEndMinute: number
    enforceEveryMinute: number
  }) {
    setGlobalError(null)
    setScheduleBusy(true)
    try {
      const created = await createSchedule({
        deviceId: input.deviceId,
        action: input.activeAction,
        cron: input.enforcementCron,
        timezone: input.timezone,
        enabled: true,
        windowGroupId: input.windowGroupId,
        windowStartMinute: input.windowStartMinute,
        windowEndMinute: input.windowEndMinute,
        enforceEveryMinute: input.enforceEveryMinute,
        idempotencyKey: crypto.randomUUID(),
      })

      await refreshScheduleData(created.id)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal membuat jadwal'))
    } finally {
      setScheduleBusy(false)
    }
  }

  async function handleToggleScheduleEnabled(schedule: ScheduleRule) {
    setGlobalError(null)
    setScheduleBusy(true)
    try {
      await patchSchedule(
        schedule.id,
        {
          enabled: !schedule.enabled,
        },
        crypto.randomUUID(),
      )
      await refreshScheduleData(schedule.id)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal mengubah status jadwal'))
    } finally {
      setScheduleBusy(false)
    }
  }

  async function handleDeleteSchedule(scheduleId: number) {
    setGlobalError(null)
    setScheduleBusy(true)
    try {
      await deleteSchedule(scheduleId, crypto.randomUUID())
      const preferredSelection = selectedScheduleId === scheduleId ? null : selectedScheduleId
      await refreshScheduleData(preferredSelection)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal menghapus jadwal'))
    } finally {
      setScheduleBusy(false)
    }
  }

  async function handleUpdateSchedule(scheduleId: number, patch: SchedulePatchInput) {
    setGlobalError(null)
    setScheduleBusy(true)
    try {
      await patchSchedule(scheduleId, patch, crypto.randomUUID())
      await refreshScheduleData(scheduleId)
    } catch (error) {
      setGlobalError(toErrorMessage(error, 'Gagal memperbarui jadwal'))
    } finally {
      setScheduleBusy(false)
    }
  }

  if (!initialized || (!isLoggedIn && loading)) {
    return (
      <main className="loading-screen">
        <p>Memuat SmartHome IoT...</p>
      </main>
    )
  }

  if (!isLoggedIn) {
    return <LoginForm loading={loading} error={authError} onLogin={handleLogin} />
  }

  return (
    <main className="dashboard-screen">
      <header className="dashboard-topbar">
        <div className="topbar-inner">
          <div className="brand-inline">
            <BulbIcon className="header-bulb" />
            <h1>
              SmartHome <span>IoT</span>
            </h1>
          </div>
          <button
            type="button"
            className="profile-pill"
            onClick={() => void handleLogout()}
            disabled={loading}
            title="Logout"
          >
            <span>Logout ({viewerLabel})</span>
            <UserCircleIcon className="profile-icon" />
          </button>
        </div>
      </header>

      <section className="dashboard-content">
        <h2>Lampu Pintar</h2>
        {globalError ? <p className="error global-error">{globalError}</p> : null}

        <div className="dashboard-grid">
          <section className="lamp-list">
            {lamps.length === 0 ? (
              <article className="lamp-empty">
                <h3>Belum ada device</h3>
                <p>Tambahkan device baru di panel manajemen untuk mulai kontrol lampu.</p>
              </article>
            ) : (
              lamps.map((lamp) => (
                <article key={lamp.device.id} className={`lamp-card ${lamp.power === 'ON' ? 'is-on' : 'is-off'}`}>
                  <div className={`lamp-icon-shell ${lamp.power === 'ON' ? 'on' : 'off'}`}>
                    <BulbIcon className="lamp-icon" />
                  </div>
                  <div className="lamp-meta">
                    <div className="lamp-meta-head">
                      <h3>{lamp.title}</h3>
                      <div className="lamp-card-actions">
                        <button
                          type="button"
                          className="lamp-mini-button"
                          disabled={loading || deviceBusy}
                          onClick={() => handleStartEditDevice(lamp.device.id)}
                          aria-label={`Edit ${lamp.title}`}
                          title={`Edit ${lamp.title}`}
                        >
                          <EditIcon className="lamp-mini-icon" />
                        </button>
                        <button
                          type="button"
                          className="lamp-mini-button danger"
                          disabled={loading || deviceBusy}
                          onClick={() => void handleDeleteDevice(lamp.device)}
                          aria-label={`Hapus ${lamp.title}`}
                          title={`Hapus ${lamp.title}`}
                        >
                          <DeleteIcon className="lamp-mini-icon" />
                        </button>
                      </div>
                    </div>
                    <p className="lamp-subtitle">
                      {lamp.device.id}
                      {lamp.device.location ? ` • ${lamp.device.location}` : ''}
                      {` • cmd: ${lamp.device.commandChannel}`}
                    </p>
                    <p className={`lamp-power ${lamp.power === 'ON' ? 'on' : 'off'}`}>{lamp.power}</p>
                    <p className="lamp-statusline">
                      {lamp.online ? 'ONLINE' : 'OFFLINE'} • source: {lamp.source} • update: {formatDateTime(lamp.updatedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`lamp-switch ${lamp.power === 'ON' ? 'on' : 'off'}`}
                    onClick={() => void handleToggleLamp(lamp)}
                    disabled={loading || deviceBusy || !!pendingToggleByDevice[lamp.device.id]}
                    aria-label={`${lamp.title} switch`}
                  >
                    <span className="lamp-switch-label">{lamp.power}</span>
                    <span className="lamp-switch-knob" />
                  </button>
                </article>
              ))
            )}
          </section>

          <aside className="monitor-card">
            <h3>Status Monitoring</h3>
            <div className="monitor-row">
              <span>Uptime</span>
              <strong>{formatUptime(uptimeSeconds)}</strong>
            </div>
            <div className="monitor-row">
              <span>Total Device</span>
              <strong>{lamps.length}</strong>
            </div>
            <div className="monitor-row">
              <span>Online Device</span>
              <strong>{onlineDeviceCount}</strong>
            </div>
            <div className="monitor-row">
              <span>Last Update</span>
              <strong>{formatDateTime(latestDeviceUpdate)}</strong>
            </div>
            <div className="monitor-row signal">
              <p>WiFi Signal</p>
              <div className="signal-content">
                <WifiIcon className="wifi-icon" />
                <div className="signal-bars" aria-hidden="true">
                  <span className="bar b1" />
                  <span className="bar b2" />
                  <span className="bar b3" />
                  <span className="bar b4" />
                  <span className="bar b5" />
                  <span className="bar b6" />
                  <span className="bar b7" />
                </div>
              </div>
            </div>
            <div className="monitor-row connection">
              <span>Connection</span>
              <strong className={isConnected ? 'connected' : 'disconnected'}>
                {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </strong>
            </div>
          </aside>
        </div>

        <section className="management-grid">
          <DeviceManager
            onCreateDevice={handleCreateDevice}
            onUpdateDevice={handleUpdateDevice}
            onCancelEdit={() => setEditingDeviceId(null)}
            editingDevice={editingDevice}
            editFocusNonce={deviceEditFocusNonce}
            onDiscover={handleDiscoverDevices}
            onClaimDiscovered={handleClaimDiscoveredDevice}
            discoveredDevices={discoveredDevices}
            discovering={discovering}
            claimingDeviceId={claimingDeviceId}
            discoveryScannedAt={discoveryScannedAt}
            discoveryWaitMs={discoveryWaitMs}
            busy={deviceBusy}
          />
          <ScheduleManager
            devices={sortedDevices}
            schedules={schedules}
            selectedScheduleId={selectedScheduleId}
            scheduleRuns={scheduleRuns}
            onSelectSchedule={handleSelectSchedule}
            onCreate={handleCreateSchedule}
            onToggleEnabled={handleToggleScheduleEnabled}
            onDelete={handleDeleteSchedule}
            onUpdate={handleUpdateSchedule}
            busy={scheduleBusy}
          />
        </section>
      </section>
    </main>
  )
}

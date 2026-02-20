import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { bootstrap, executeCommand, getFallbackStatus, login, logout } from './lib/api'
import { createRealtimeClient, type RealtimeClient } from './lib/realtime'
import type { BootstrapResponse, Device } from './lib/types'
import { LoginForm } from './components/LoginForm'
import { BulbIcon, UserCircleIcon, WifiIcon } from './components/UiIcons'

type DeviceState = {
  power: string
  updatedAt: string | null
  online: boolean
}

type DeviceStateMap = Record<string, DeviceState>

type LampView = {
  slot: number
  title: string
  device: Device | null
  power: 'ON' | 'OFF'
  online: boolean
}

const DEFAULT_LAMP_POWER: Array<'ON' | 'OFF'> = ['ON', 'OFF', 'ON']

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

function normalizePower(value: string | undefined, index: number): 'ON' | 'OFF' {
  if (value === 'ON' || value === 'OFF') {
    return value
  }
  return DEFAULT_LAMP_POWER[index] ?? 'OFF'
}

function formatUptime(totalSeconds: number) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export default function App() {
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceState, setDeviceState] = useState<DeviceStateMap>({})
  const [uptimeSeconds, setUptimeSeconds] = useState(0)

  const realtimeRef = useRef<RealtimeClient | null>(null)
  const isLoggedIn = initialized && hasSession

  async function hydrateDashboard(boot?: BootstrapResponse) {
    setGlobalError(null)
    const bootstrapData = boot ?? (await bootstrap())
    if (!bootstrapData.realtime) {
      setHasSession(false)
      setDevices([])
      setDeviceState({})
      if (realtimeRef.current) {
        await realtimeRef.current.disconnect()
        realtimeRef.current = null
      }
      return
    }

    setHasSession(true)
    setDevices(bootstrapData.devices)

    const statuses = await getFallbackStatus()
    setDeviceState(mergeFallbackStatuses(bootstrapData.devices, statuses))

    if (realtimeRef.current) {
      realtimeRef.current.resubscribe(bootstrapData.devices.map((device) => device.id))
      return
    }

    realtimeRef.current = createRealtimeClient(bootstrapData.devices.map((device) => device.id), {
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
        setGlobalError(`Realtime stream error: ${error.message}`)
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
      if (realtimeRef.current) {
        void realtimeRef.current.disconnect()
        realtimeRef.current = null
      }
    }
  }, [])

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

  const sortedDevices = useMemo(() => [...devices].sort((a, b) => a.name.localeCompare(b.name)), [devices])

  const lamps = useMemo<LampView[]>(
    () =>
      Array.from({ length: 3 }, (_, index) => {
        const device = sortedDevices[index] ?? null
        const state = device ? deviceState[device.id] : null

        return {
          slot: index + 1,
          title: `Lampu ${index + 1}`,
          device,
          power: normalizePower(state?.power, index),
          online: state?.online ?? index !== 1,
        }
      }),
    [sortedDevices, deviceState],
  )

  const isConnected = lamps.some((lamp) => lamp.online)

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
      if (realtimeRef.current) {
        await realtimeRef.current.disconnect()
        realtimeRef.current = null
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleLamp(lamp: LampView) {
    if (!lamp.device) return

    const action = lamp.power === 'ON' ? 'OFF' : 'ON'
    setGlobalError(null)

    try {
      await executeCommand({
        deviceId: lamp.device.id,
        action,
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      })
      setDeviceState((prev) => ({
        ...prev,
        [lamp.device!.id]: {
          ...(prev[lamp.device!.id] ?? {
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
          <button type="button" className="profile-pill" onClick={() => void handleLogout()} disabled={loading}>
            <span>Hello, User123</span>
            <UserCircleIcon className="profile-icon" />
          </button>
        </div>
      </header>

      <section className="dashboard-content">
        <h2>Lampu Pintar</h2>
        {globalError ? <p className="error global-error">{globalError}</p> : null}

        <div className="dashboard-grid">
          <section className="lamp-list">
            {lamps.map((lamp) => (
              <article key={lamp.slot} className={`lamp-card ${lamp.power === 'ON' ? 'is-on' : 'is-off'}`}>
                <div className={`lamp-icon-shell ${lamp.power === 'ON' ? 'on' : 'off'}`}>
                  <BulbIcon className="lamp-icon" />
                </div>
                <div className="lamp-meta">
                  <h3>{lamp.title}</h3>
                  <p className={`lamp-power ${lamp.power === 'ON' ? 'on' : 'off'}`}>{lamp.power}</p>
                </div>
                <button
                  type="button"
                  className={`lamp-switch ${lamp.power === 'ON' ? 'on' : 'off'}`}
                  onClick={() => void handleToggleLamp(lamp)}
                  disabled={!lamp.device || loading}
                  aria-label={`${lamp.title} switch`}
                >
                  <span className="lamp-switch-label">{lamp.power}</span>
                  <span className="lamp-switch-knob" />
                </button>
              </article>
            ))}
          </section>

          <aside className="monitor-card">
            <h3>Status Monitoring</h3>
            <div className="monitor-row">
              <span>Uptime</span>
              <strong>{formatUptime(uptimeSeconds)}</strong>
            </div>
            <div className="monitor-row">
              <span>IP Address:</span>
              <strong>192.168.1.50</strong>
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
      </section>
    </main>
  )
}

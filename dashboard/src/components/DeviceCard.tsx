import type { Device } from '../lib/types'

type DeviceState = {
  power: string
  updatedAt: string | null
  online: boolean
}

type DeviceCardProps = {
  device: Device
  state: DeviceState
  onAction: (deviceId: string, action: 'ON' | 'OFF') => Promise<void>
}

export function DeviceCard({ device, state, onAction }: DeviceCardProps) {
  return (
    <article className="device-card">
      <header>
        <h3>{device.name}</h3>
        <span className={state.online ? 'badge online' : 'badge offline'}>
          {state.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </header>
      <p className="device-location">{device.location ?? 'Lokasi belum di-set'}</p>
      <p className="power-state">Power: {state.power}</p>
      <p className="last-update">
        Last update: {state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'belum ada data'}
      </p>
      <div className="controls">
        <button onClick={() => onAction(device.id, 'ON')}>Turn ON</button>
        <button onClick={() => onAction(device.id, 'OFF')} className="off">
          Turn OFF
        </button>
      </div>
    </article>
  )
}

export type { DeviceState }

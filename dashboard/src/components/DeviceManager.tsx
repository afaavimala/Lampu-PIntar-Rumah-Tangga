import { useState } from 'react'
import type { DiscoveredDevice } from '../lib/types'

type DeviceManagerProps = {
  onCreateDevice: (input: {
    deviceId: string
    name: string
    location?: string
  }) => Promise<void>
  onDiscover: () => Promise<void>
  onClaimDiscovered: (device: DiscoveredDevice) => Promise<void>
  discoveredDevices: DiscoveredDevice[]
  discovering?: boolean
  claimingDeviceId?: string | null
  discoveryScannedAt?: string | null
  discoveryWaitMs?: number | null
  busy?: boolean
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }

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

export function DeviceManager({
  onCreateDevice,
  onDiscover,
  onClaimDiscovered,
  discoveredDevices,
  discovering = false,
  claimingDeviceId = null,
  discoveryScannedAt = null,
  discoveryWaitMs = null,
  busy = false,
}: DeviceManagerProps) {
  const [deviceId, setDeviceId] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)

  return (
    <section className="device-create">
      <h3>Tambah Device</h3>
      <form
        className="device-create-form"
        onSubmit={async (event) => {
          event.preventDefault()
          setSubmitting(true)
          try {
            await onCreateDevice({
              deviceId: deviceId.trim(),
              name: name.trim(),
              location: location.trim() || undefined,
            })
            setDeviceId('')
            setName('')
            setLocation('')
          } finally {
            setSubmitting(false)
          }
        }}
      >
        <label>
          Device ID
          <input
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            placeholder="contoh: lampu-teras"
            required
            disabled={busy || submitting}
          />
        </label>
        <label>
          Nama Device
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="contoh: Lampu Teras"
            required
            disabled={busy || submitting}
          />
        </label>
        <label>
          Lokasi (opsional)
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="contoh: Teras Depan"
            disabled={busy || submitting}
          />
        </label>
        <button type="submit" disabled={busy || submitting}>
          {submitting ? 'Menyimpan...' : 'Tambah Device'}
        </button>
      </form>
      <p className="small">
        Topic command Tasmota: cmnd/&lt;deviceId&gt;/POWER (juga kompatibel dengan &lt;deviceId&gt;/cmnd/POWER)
      </p>

      <section className="device-discovery">
        <div className="device-discovery-head">
          <h4>Discovery Tasmota</h4>
          <button
            type="button"
            className="device-discovery-button"
            onClick={() => void onDiscover()}
            disabled={busy || submitting || discovering}
          >
            {discovering ? 'Scanning...' : 'Scan Device'}
          </button>
        </div>

        <p className="small">
          Last scan: {formatDateTime(discoveryScannedAt)}
          {typeof discoveryWaitMs === 'number' ? ` (window ${discoveryWaitMs}ms)` : ''}
        </p>

        {discoveredDevices.length === 0 ? (
          <p className="small">Belum ada device Tasmota terdeteksi.</p>
        ) : (
          <ul className="device-discovery-list">
            {discoveredDevices.map((device) => {
              const claimDisabled =
                busy ||
                submitting ||
                discovering ||
                claimingDeviceId === device.deviceId ||
                device.alreadyLinked ||
                device.alreadyRegistered
              const claimLabel = device.alreadyLinked
                ? 'Sudah Ditambahkan'
                : device.alreadyRegistered
                  ? 'Sudah Terdaftar'
                  : claimingDeviceId === device.deviceId
                    ? 'Menambah...'
                    : 'Tambah'

              return (
                <li key={device.deviceId}>
                  <div className="device-discovery-meta">
                    <strong>{device.deviceId}</strong>
                    <p>
                      Nama: {device.suggestedName} • Power: {device.power} •{' '}
                      {device.online == null ? 'ONLINE ?' : device.online ? 'ONLINE' : 'OFFLINE'}
                    </p>
                    <p>
                      Source: {device.sources.join(', ') || '-'} • Last seen:{' '}
                      {formatDateTime(device.lastSeenAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`device-discovery-claim ${device.alreadyLinked || device.alreadyRegistered ? 'off' : ''}`}
                    onClick={() => void onClaimDiscovered(device)}
                    disabled={claimDisabled}
                  >
                    {claimLabel}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </section>
  )
}

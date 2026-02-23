import { useEffect, useRef, useState } from 'react'
import type { Device, DiscoveredDevice } from '../lib/types'

type DeviceManagerProps = {
  onCreateDevice: (input: {
    deviceId: string
    name: string
    location?: string
    commandChannel?: string
  }) => Promise<void>
  onUpdateDevice: (input: {
    deviceId: string
    name: string
    location?: string
    commandChannel?: string
  }) => Promise<void>
  onCancelEdit: () => void
  editingDevice: Device | null
  editFocusNonce?: number
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
  onUpdateDevice,
  onCancelEdit,
  editingDevice,
  editFocusNonce = 0,
  onDiscover,
  onClaimDiscovered,
  discoveredDevices,
  discovering = false,
  claimingDeviceId = null,
  discoveryScannedAt = null,
  discoveryWaitMs = null,
  busy = false,
}: DeviceManagerProps) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [commandChannel, setCommandChannel] = useState('POWER')
  const [submitting, setSubmitting] = useState(false)
  const isEditing = !!editingDevice

  useEffect(() => {
    if (!editingDevice) {
      setDeviceId('')
      setName('')
      setLocation('')
      setCommandChannel('POWER')
      return
    }

    setDeviceId(editingDevice.id)
    setName(editingDevice.name)
    setLocation(editingDevice.location ?? '')
    setCommandChannel(editingDevice.commandChannel || 'POWER')
  }, [editingDevice])

  useEffect(() => {
    if (!editingDevice) {
      return
    }

    sectionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })

    const timerId = window.setTimeout(() => {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }, 180)

    return () => window.clearTimeout(timerId)
  }, [editingDevice, editFocusNonce])

  return (
    <section ref={sectionRef} className="device-create">
      <h3>{isEditing ? 'Edit Device' : 'Tambah Device'}</h3>
      <form
        className="device-create-form"
        onSubmit={async (event) => {
          event.preventDefault()
          setSubmitting(true)
          try {
            const payload = {
              name: name.trim(),
              location: location.trim() || undefined,
              commandChannel: commandChannel.trim() || undefined,
            }

            if (editingDevice) {
              await onUpdateDevice({
                deviceId: editingDevice.id,
                ...payload,
              })
            } else {
              await onCreateDevice({
                deviceId: deviceId.trim(),
                ...payload,
              })
              setDeviceId('')
              setName('')
              setLocation('')
              setCommandChannel('POWER')
            }
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
            disabled={busy || submitting || isEditing}
          />
        </label>
        <label>
          Nama Device
          <input
            ref={nameInputRef}
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
        <label>
          Channel Command (opsional)
          <input
            value={commandChannel}
            onChange={(event) => setCommandChannel(event.target.value)}
            placeholder="default: POWER (contoh: POWER2)"
            disabled={busy || submitting}
          />
        </label>
        {isEditing ? (
          <div className="device-form-actions">
            <button type="submit" disabled={busy || submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || submitting}
              onClick={() => {
                onCancelEdit()
              }}
            >
              Batal
            </button>
          </div>
        ) : (
          <button type="submit" disabled={busy || submitting}>
            {submitting ? 'Menyimpan...' : 'Tambah Device'}
          </button>
        )}
      </form>
      <p className="small">
        Topic command Tasmota: cmnd/&lt;deviceId&gt;/&lt;commandChannel&gt; (default: POWER)
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
                      Channels: {device.availableCommandChannels.length ? device.availableCommandChannels.join(', ') : 'POWER'} •
                      {' '}Auto cmd: {device.suggestedCommandChannel}
                    </p>
                    <p>
                      Source: {device.sources.join(', ') || '-'} • Topic: {device.tasmotaTopic || '-'} • Last seen:{' '}
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

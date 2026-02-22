import { useState } from 'react'

type DeviceManagerProps = {
  onCreateDevice: (input: {
    deviceId: string
    name: string
    location?: string
    hmacSecret?: string
  }) => Promise<void>
}

export function DeviceManager({ onCreateDevice }: DeviceManagerProps) {
  const [deviceId, setDeviceId] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [hmacSecret, setHmacSecret] = useState('')
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
              hmacSecret: hmacSecret.trim() || undefined,
            })
            setDeviceId('')
            setName('')
            setLocation('')
            setHmacSecret('')
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
          />
        </label>
        <label>
          Nama Device
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="contoh: Lampu Teras"
            required
          />
        </label>
        <label>
          Lokasi (opsional)
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="contoh: Teras Depan"
          />
        </label>
        <label>
          HMAC Secret (opsional)
          <input
            value={hmacSecret}
            onChange={(event) => setHmacSecret(event.target.value)}
            placeholder="kosongkan untuk pakai fallback backend"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Menyimpan...' : 'Tambah Device'}
        </button>
      </form>
      <p className="small">
        Topic command kompatibel: home/&lt;deviceId&gt;/cmd dan Tasmota cmnd/&lt;deviceId&gt;/POWER
      </p>
    </section>
  )
}

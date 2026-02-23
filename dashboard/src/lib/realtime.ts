type RealtimeHandlers = {
  onStatus: (deviceId: string, payload: Record<string, unknown>) => void
  onLwt: (deviceId: string, payload: string) => void
  onError: (error: Error) => void
}

type RealtimeClientOptions = {
  streamPath?: string
}

type RealtimeEvent =
  | {
      type: 'status'
      deviceId: string
      payload: Record<string, unknown>
      ts: number
    }
  | {
      type: 'lwt'
      deviceId: string
      payload: string
      ts: number
    }
  | {
      type: 'hello' | 'ping'
      ts: number
    }

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function createRealtimeClient(
  deviceIds: string[],
  handlers: RealtimeHandlers,
  options: RealtimeClientOptions = {},
) {
  const trackedDeviceIds = new Set(deviceIds)
  const streamPath = options.streamPath ?? '/api/v1/realtime/stream'
  const streamUrl =
    streamPath.startsWith('http://') || streamPath.startsWith('https://')
      ? streamPath
      : `${API_BASE}${streamPath}`
  const source = new EventSource(streamUrl, { withCredentials: true })
  let reportedError = false

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeEvent
      reportedError = false

      if (payload.type === 'status') {
        if (!trackedDeviceIds.has(payload.deviceId)) {
          return
        }
        handlers.onStatus(payload.deviceId, payload.payload)
        return
      }

      if (payload.type === 'lwt') {
        if (!trackedDeviceIds.has(payload.deviceId)) {
          return
        }
        handlers.onLwt(payload.deviceId, payload.payload)
      }
    } catch {
      // ignore invalid stream payload
    }
  }

  source.onerror = () => {
    if (reportedError) {
      return
    }
    reportedError = true
    handlers.onError(new Error('Realtime stream disconnected'))
  }

  function disconnect() {
    return new Promise<void>((resolve) => {
      source.close()
      resolve()
    })
  }

  function resubscribe(newDeviceIds: string[]) {
    trackedDeviceIds.clear()
    for (const deviceId of newDeviceIds) {
      trackedDeviceIds.add(deviceId)
    }
  }

  return {
    client: source,
    disconnect,
    resubscribe,
  }
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>

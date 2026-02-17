import { publishMqttOverWs } from './mqtt-ws'
import type { SignedCommandEnvelope } from './commands'

const CONNECT_PACKET_TYPE = 0x10
const CONNACK_PACKET_TYPE = 0x20
const PUBLISH_PACKET_TYPE = 0x30
const SUBSCRIBE_PACKET_TYPE = 0x82
const SUBACK_PACKET_TYPE = 0x90
const PINGREQ_PACKET_TYPE = 0xc0
const PINGRESP_PACKET_TYPE = 0xd0

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

type RealtimeSubscriber = {
  deviceIds: Set<string>
  onEvent: (event: RealtimeEvent) => void
}

type RealtimeProxyConfig = {
  url: string
  username?: string
  password?: string
  clientIdPrefix?: string
  connectTimeoutMs?: number
}

function encodeVarInt(value: number) {
  const out: number[] = []
  let x = value
  do {
    let byte = x % 128
    x = Math.floor(x / 128)
    if (x > 0) {
      byte |= 0x80
    }
    out.push(byte)
  } while (x > 0)
  return new Uint8Array(out)
}

function encodeMqttString(value: string) {
  const data = new TextEncoder().encode(value)
  const out = new Uint8Array(2 + data.length)
  out[0] = (data.length >> 8) & 0xff
  out[1] = data.length & 0xff
  out.set(data, 2)
  return out
}

function concat(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, item) => sum + item.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function buildConnectPacket(input: {
  clientId: string
  username?: string
  password?: string
  keepAliveSec?: number
}) {
  const protocolName = encodeMqttString('MQTT')
  const protocolLevel = new Uint8Array([0x04])
  let connectFlags = 0x02
  const payloadParts: Uint8Array[] = [encodeMqttString(input.clientId)]

  if (input.username) {
    connectFlags |= 0x80
    payloadParts.push(encodeMqttString(input.username))
  }

  if (input.password) {
    connectFlags |= 0x40
    payloadParts.push(encodeMqttString(input.password))
  }

  const keepAlive = input.keepAliveSec ?? 30
  const keepAliveBytes = new Uint8Array([(keepAlive >> 8) & 0xff, keepAlive & 0xff])

  const variableHeader = concat(
    protocolName,
    protocolLevel,
    new Uint8Array([connectFlags]),
    keepAliveBytes,
  )
  const payload = concat(...payloadParts)
  const remainingLength = encodeVarInt(variableHeader.length + payload.length)

  return concat(new Uint8Array([CONNECT_PACKET_TYPE]), remainingLength, variableHeader, payload)
}

function buildSubscribePacket(packetId: number, topics: string[]) {
  const packetIdBytes = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])
  const topicBytes = topics.map((topic) => concat(encodeMqttString(topic), new Uint8Array([0x00])))
  const payload = concat(...topicBytes)
  const remainingLength = encodeVarInt(packetIdBytes.length + payload.length)

  return concat(new Uint8Array([SUBSCRIBE_PACKET_TYPE]), remainingLength, packetIdBytes, payload)
}

async function toBytes(data: unknown): Promise<Uint8Array> {
  if (data instanceof Uint8Array) {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }

  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }

  throw new Error('Unsupported WebSocket message payload type')
}

function decodeRemainingLength(buffer: Uint8Array) {
  let multiplier = 1
  let value = 0
  let offset = 1
  let encoded = 0

  do {
    if (offset >= buffer.length) {
      return null
    }
    encoded = buffer[offset]
    value += (encoded & 0x7f) * multiplier
    multiplier *= 128
    offset += 1
  } while ((encoded & 0x80) !== 0)

  return {
    remainingLength: value,
    headerLength: offset,
  }
}

function pullOnePacket(buffer: Uint8Array) {
  if (buffer.length < 2) {
    return null
  }

  const decoded = decodeRemainingLength(buffer)
  if (!decoded) {
    return null
  }

  const totalLength = decoded.headerLength + decoded.remainingLength
  if (buffer.length < totalLength) {
    return null
  }

  return {
    packet: buffer.slice(0, totalLength),
    rest: buffer.slice(totalLength),
  }
}

function readConnAckReturnCode(packet: Uint8Array) {
  if (packet.length < 4) return 255
  return packet[3]
}

function extractPublishPacket(packet: Uint8Array) {
  const decoded = decodeRemainingLength(packet)
  if (!decoded) {
    return null
  }

  const qos = (packet[0] >> 1) & 0x03
  let offset = decoded.headerLength
  if (offset + 2 > packet.length) {
    return null
  }

  const topicLength = (packet[offset] << 8) | packet[offset + 1]
  offset += 2
  if (offset + topicLength > packet.length) {
    return null
  }

  const topic = new TextDecoder().decode(packet.slice(offset, offset + topicLength))
  offset += topicLength

  if (qos > 0) {
    if (offset + 2 > packet.length) {
      return null
    }
    offset += 2
  }

  const payload = new TextDecoder().decode(packet.slice(offset))

  return {
    topic,
    payload,
  }
}

function extractDeviceId(topic: string) {
  const parts = topic.split('/')
  return parts.length >= 3 ? parts[1] : ''
}

export class RealtimeMqttProxy {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private packetBuffer = new Uint8Array(0)
  private stopped = false
  private connected = false
  private subscribers = new Map<number, RealtimeSubscriber>()
  private nextSubscriberId = 1
  private nextPacketIdValue = 1

  constructor(private readonly config: RealtimeProxyConfig) {}

  start() {
    this.stopped = false
    this.ensureConnected()
  }

  stop() {
    this.stopped = true
    this.connected = false
    this.packetBuffer = new Uint8Array(0)

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // noop
      }
      this.ws = null
    }
  }

  subscribe(deviceIds: string[], onEvent: (event: RealtimeEvent) => void) {
    const id = this.nextSubscriberId++
    this.subscribers.set(id, {
      deviceIds: new Set(deviceIds),
      onEvent,
    })

    this.ensureConnected()

    return () => {
      this.subscribers.delete(id)
    }
  }

  async publishSignedCommand(envelope: SignedCommandEnvelope) {
    await publishMqttOverWs({
      url: this.config.url,
      username: this.config.username,
      password: this.config.password,
      clientIdPrefix: this.config.clientIdPrefix,
      topic: `home/${envelope.deviceId}/cmd`,
      payload: JSON.stringify(envelope),
    })
  }

  private ensureConnected() {
    if (this.stopped || this.ws) {
      return
    }

    this.packetBuffer = new Uint8Array(0)
    const ws = new WebSocket(this.config.url, ['mqtt'])
    this.ws = ws
    const timeoutMs = this.config.connectTimeoutMs ?? 10_000
    let connAcked = false

    const connAckTimeout = setTimeout(() => {
      if (connAcked) {
        return
      }
      try {
        ws.close()
      } catch {
        // noop
      }
    }, timeoutMs)

    ws.addEventListener('open', () => {
      const clientId = `${this.config.clientIdPrefix ?? 'smartlamp-proxy'}-${crypto.randomUUID().slice(0, 8)}`
      ws.send(
        buildConnectPacket({
          clientId,
          username: this.config.username,
          password: this.config.password,
        }),
      )
    })

    ws.addEventListener('message', (event) => {
      void (async () => {
        const bytes = await toBytes(event.data)
        this.packetBuffer = concat(this.packetBuffer, bytes)
        while (true) {
          const pulled = pullOnePacket(this.packetBuffer)
          if (!pulled) {
            break
          }

          this.packetBuffer = pulled.rest
          const packet = pulled.packet
          const packetType = packet[0] & 0xf0

          if (packetType === CONNACK_PACKET_TYPE) {
            const returnCode = readConnAckReturnCode(packet)
            if (returnCode !== 0) {
              console.error(`[realtime-proxy] MQTT CONNACK rejected with code ${returnCode}`)
              try {
                ws.close()
              } catch {
                // noop
              }
              return
            }

            connAcked = true
            this.connected = true
            clearTimeout(connAckTimeout)
            ws.send(buildSubscribePacket(this.nextPacketId(), ['home/+/status', 'home/+/lwt']))
            this.startPing(ws)
            continue
          }

          if (packetType === SUBACK_PACKET_TYPE || packetType === PINGRESP_PACKET_TYPE) {
            continue
          }

          if (packetType !== PUBLISH_PACKET_TYPE) {
            continue
          }

          const decoded = extractPublishPacket(packet)
          if (!decoded) {
            continue
          }

          const deviceId = extractDeviceId(decoded.topic)
          if (!deviceId) {
            continue
          }

          if (decoded.topic.endsWith('/status')) {
            let payload: Record<string, unknown> = { raw: decoded.payload }
            try {
              const parsed = JSON.parse(decoded.payload) as Record<string, unknown>
              payload = parsed
            } catch {
              // keep raw
            }

            this.emitEvent({
              type: 'status',
              deviceId,
              payload,
              ts: Date.now(),
            })
            continue
          }

          if (decoded.topic.endsWith('/lwt')) {
            this.emitEvent({
              type: 'lwt',
              deviceId,
              payload: decoded.payload,
              ts: Date.now(),
            })
          }
        }
      })()
    })

    const cleanup = () => {
      clearTimeout(connAckTimeout)
      this.connected = false
      if (this.ws === ws) {
        this.ws = null
      }
      if (this.pingTimer) {
        clearInterval(this.pingTimer)
        this.pingTimer = null
      }
      if (!this.stopped && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.ensureConnected()
        }, 2_000)
      }
    }

    ws.addEventListener('close', cleanup)
    ws.addEventListener('error', cleanup)
  }

  private startPing(ws: WebSocket) {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
    }

    this.pingTimer = setInterval(() => {
      if (this.stopped || this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
        return
      }
      try {
        ws.send(new Uint8Array([PINGREQ_PACKET_TYPE, 0x00]))
      } catch {
        // noop
      }
    }, 15_000)
  }

  private nextPacketId() {
    const id = this.nextPacketIdValue
    this.nextPacketIdValue = id >= 65_535 ? 1 : id + 1
    return id
  }

  private emitEvent(event: RealtimeEvent) {
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.deviceIds.has(event.deviceId)) {
        continue
      }
      try {
        subscriber.onEvent(event)
      } catch {
        // ignore subscriber failure
      }
    }
  }
}

let activeRealtimeProxy: RealtimeMqttProxy | null = null

export function initializeRealtimeMqttProxy(config: RealtimeProxyConfig) {
  if (activeRealtimeProxy) {
    return activeRealtimeProxy
  }
  activeRealtimeProxy = new RealtimeMqttProxy(config)
  activeRealtimeProxy.start()
  return activeRealtimeProxy
}

export function getRealtimeMqttProxy() {
  return activeRealtimeProxy
}

export function shutdownRealtimeMqttProxy() {
  if (!activeRealtimeProxy) {
    return
  }
  activeRealtimeProxy.stop()
  activeRealtimeProxy = null
}

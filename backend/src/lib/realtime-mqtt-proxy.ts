import { buildCommandPublishTargets, parseRealtimeMqttMessage, getRealtimeSubscribeTopics } from './mqtt-compat'
import type { CommandDispatchEnvelope } from './commands'

const CONNECT_PACKET_TYPE = 0x10
const CONNACK_PACKET_TYPE = 0x20
const PUBLISH_PACKET_TYPE = 0x30
const PUBLISH_QOS1_PACKET_TYPE = 0x32
const PUBACK_PACKET_TYPE = 0x40
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

type SubscribeOptions = {
  replayLatest?: boolean
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

function buildPublishQos1Packet(input: {
  topic: string
  payload: string
  packetId: number
}) {
  const topicBytes = encodeMqttString(input.topic)
  const packetIdBytes = new Uint8Array([(input.packetId >> 8) & 0xff, input.packetId & 0xff])
  const payloadBytes = new TextEncoder().encode(input.payload)
  const remainingLength = encodeVarInt(topicBytes.length + packetIdBytes.length + payloadBytes.length)

  return concat(
    new Uint8Array([PUBLISH_QOS1_PACKET_TYPE]),
    remainingLength,
    topicBytes,
    packetIdBytes,
    payloadBytes,
  )
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

function readPubAckPacketId(packet: Uint8Array) {
  if (packet.length < 4) return -1
  return (packet[2] << 8) | packet[3]
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
  private latestStatusByDevice = new Map<string, { payload: Record<string, unknown>; ts: number }>()
  private latestLwtByDevice = new Map<string, { payload: string; ts: number }>()
  private publishQueue = Promise.resolve()
  private connectionWaiters = new Set<{
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private pendingPublishAcks = new Map<number, {
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(private readonly config: RealtimeProxyConfig) {}

  start() {
    this.stopped = false
    this.ensureConnected()
  }

  stop() {
    this.stopped = true
    this.connected = false
    this.packetBuffer = new Uint8Array(0)
    this.rejectConnectionWaiters(new Error('Realtime MQTT proxy stopped'))
    this.rejectPendingPublishes(new Error('Realtime MQTT proxy stopped'))

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

  subscribe(deviceIds: string[], onEvent: (event: RealtimeEvent) => void, options?: SubscribeOptions) {
    const id = this.nextSubscriberId++
    const trackedDeviceIds = new Set(deviceIds)
    this.subscribers.set(id, {
      deviceIds: trackedDeviceIds,
      onEvent,
    })

    this.ensureConnected()

    if (options?.replayLatest ?? true) {
      for (const deviceId of trackedDeviceIds) {
        const latestStatus = this.latestStatusByDevice.get(deviceId)
        if (latestStatus) {
          onEvent({
            type: 'status',
            deviceId,
            payload: latestStatus.payload,
            ts: latestStatus.ts,
          })
        }

        const latestLwt = this.latestLwtByDevice.get(deviceId)
        if (latestLwt) {
          onEvent({
            type: 'lwt',
            deviceId,
            payload: latestLwt.payload,
            ts: latestLwt.ts,
          })
        }
      }
    }

    return () => {
      this.subscribers.delete(id)
    }
  }

  async publishCommand(envelope: CommandDispatchEnvelope) {
    const targets = buildCommandPublishTargets({
      deviceId: envelope.deviceId,
      action: envelope.action,
    })

    const publishResults = await Promise.allSettled(
      targets.map((target) => this.enqueuePublish(target.topic, target.payload)),
    )

    const errors: string[] = []
    let succeeded = 0
    for (let index = 0; index < publishResults.length; index += 1) {
      const result = publishResults[index]
      const target = targets[index]

      if (result.status === 'fulfilled') {
        succeeded += 1
        continue
      }

      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors.push(`${target.topic}: ${message}`)
    }

    if (succeeded > 0) {
      return
    }

    const details = errors.join('; ') || 'unknown publish error'
    throw new Error(`Failed to publish command on all MQTT topic profiles (${details})`)
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
              this.rejectConnectionWaiters(new Error(`MQTT CONNACK rejected with code ${returnCode}`))
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
            ws.send(buildSubscribePacket(this.nextPacketId(), getRealtimeSubscribeTopics()))
            this.startPing(ws)
            this.resolveConnectionWaiters()
            continue
          }

          if (packetType === SUBACK_PACKET_TYPE || packetType === PINGRESP_PACKET_TYPE) {
            continue
          }

          if (packetType === PUBACK_PACKET_TYPE) {
            const packetId = readPubAckPacketId(packet)
            const pending = this.pendingPublishAcks.get(packetId)
            if (!pending) {
              continue
            }

            this.pendingPublishAcks.delete(packetId)
            clearTimeout(pending.timer)
            pending.resolve()
            continue
          }

          if (packetType !== PUBLISH_PACKET_TYPE) {
            continue
          }

          const decoded = extractPublishPacket(packet)
          if (!decoded) {
            continue
          }

          const parsed = parseRealtimeMqttMessage(decoded.topic, decoded.payload)
          if (!parsed || !parsed.deviceId) {
            continue
          }

          this.emitEvent({
            ...parsed,
            ts: Date.now(),
          })
        }
      })()
    })

    const cleanup = () => {
      clearTimeout(connAckTimeout)
      this.connected = false
      this.rejectConnectionWaiters(new Error('Realtime MQTT connection closed'))
      this.rejectPendingPublishes(new Error('Realtime MQTT connection closed'))
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

  private enqueuePublish(topic: string, payload: string, timeoutMs = 10_000) {
    const run = async () => {
      await this.publishOne(topic, payload, timeoutMs)
    }

    const task = this.publishQueue.then(run, run)
    this.publishQueue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  private async publishOne(topic: string, payload: string, timeoutMs: number) {
    await this.waitUntilConnected(timeoutMs)

    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.connected) {
      throw new Error('Realtime MQTT proxy is not connected')
    }

    const packetId = this.nextPacketId()
    let pendingTimer: ReturnType<typeof setTimeout> | null = null

    const ackPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPublishAcks.delete(packetId)
        reject(new Error(`Timed out waiting MQTT PUBACK for ${topic}`))
      }, timeoutMs)

      pendingTimer = timer
      this.pendingPublishAcks.set(packetId, {
        resolve,
        reject,
        timer,
      })
    })

    try {
      ws.send(
        buildPublishQos1Packet({
          topic,
          payload,
          packetId,
        }),
      )
    } catch (error) {
      if (pendingTimer) {
        this.pendingPublishAcks.delete(packetId)
        clearTimeout(pendingTimer)
      }

      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to send MQTT publish packet (${message})`)
    }

    await ackPromise
  }

  private async waitUntilConnected(timeoutMs: number) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return
    }

    this.ensureConnected()

    await new Promise<void>((resolve, reject) => {
      let waiter:
        | {
            resolve: () => void
            reject: (error: Error) => void
            timer: ReturnType<typeof setTimeout>
          }
        | null = null

      const onResolve = () => {
        if (!waiter) {
          return
        }
        this.connectionWaiters.delete(waiter)
        clearTimeout(waiter.timer)
        resolve()
      }

      const onReject = (error: Error) => {
        if (!waiter) {
          return
        }
        this.connectionWaiters.delete(waiter)
        clearTimeout(waiter.timer)
        reject(error)
      }

      waiter = {
        resolve: onResolve,
        reject: onReject,
        timer: setTimeout(() => {
          if (!waiter) {
            return
          }
          this.connectionWaiters.delete(waiter)
          reject(new Error('Timed out waiting for realtime MQTT connection'))
        }, timeoutMs),
      }

      this.connectionWaiters.add(waiter)

      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        onResolve()
      }
    })
  }

  private resolveConnectionWaiters() {
    const waiters = Array.from(this.connectionWaiters)
    this.connectionWaiters.clear()
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
  }

  private rejectConnectionWaiters(error: Error) {
    const waiters = Array.from(this.connectionWaiters)
    this.connectionWaiters.clear()
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  private rejectPendingPublishes(error: Error) {
    const pendingPublishes = Array.from(this.pendingPublishAcks.values())
    this.pendingPublishAcks.clear()
    for (const pending of pendingPublishes) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }

  private emitEvent(event: RealtimeEvent) {
    if (event.type === 'status') {
      this.latestStatusByDevice.set(event.deviceId, {
        payload: event.payload,
        ts: event.ts,
      })
    } else {
      this.latestLwtByDevice.set(event.deviceId, {
        payload: event.payload,
        ts: event.ts,
      })
    }

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

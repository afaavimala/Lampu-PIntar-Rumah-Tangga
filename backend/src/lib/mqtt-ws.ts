const CONNECT_PACKET_TYPE = 0x10
const CONNACK_PACKET_TYPE = 0x20
const PUBLISH_PACKET_TYPE = 0x30
const PUBLISH_QOS1_PACKET_TYPE = 0x32
const PUBACK_PACKET_TYPE = 0x40
const SUBSCRIBE_PACKET_TYPE = 0x82
const SUBACK_PACKET_TYPE = 0x90
const DISCONNECT_PACKET_TYPE = 0xe0

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

function buildSubscribePacket(packetId: number, topics: string[]) {
  const packetIdBytes = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])
  const topicBytes = topics.map((topic) => concat(encodeMqttString(topic), new Uint8Array([0x00])))
  const payload = concat(...topicBytes)
  const remainingLength = encodeVarInt(packetIdBytes.length + payload.length)

  return concat(new Uint8Array([SUBSCRIBE_PACKET_TYPE]), remainingLength, packetIdBytes, payload)
}

function buildDisconnectPacket() {
  return new Uint8Array([DISCONNECT_PACKET_TYPE, 0x00])
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

function packetType(packet: Uint8Array) {
  return packet[0] & 0xf0
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

function readPubAckPacketId(packet: Uint8Array) {
  if (packet.length < 4) return -1
  return (packet[2] << 8) | packet[3]
}

function readSubAckPacketId(packet: Uint8Array) {
  if (packet.length < 4) return -1
  return (packet[2] << 8) | packet[3]
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

  const flags = packet[0]
  const qos = (flags >> 1) & 0x03
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

export async function publishMqttOverWs(input: {
  url: string
  topic: string
  payload: string
  username?: string
  password?: string
  clientIdPrefix?: string
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? 10_000
  const clientId = `${input.clientIdPrefix ?? 'smartlamp'}-${crypto.randomUUID().slice(0, 8)}`
  const ws = new WebSocket(input.url, ['mqtt'])

  const queue: Uint8Array[] = []
  let queueNotifier: (() => void) | null = null
  let packetBuffer = new Uint8Array(0)

  ws.addEventListener('message', (event) => {
    void (async () => {
      const bytes = await toBytes(event.data)
      packetBuffer = concat(packetBuffer, bytes)
      while (true) {
        const pulled = pullOnePacket(packetBuffer)
        if (!pulled) {
          break
        }
        packetBuffer = pulled.rest
        queue.push(pulled.packet)
      }
      if (queueNotifier) {
        queueNotifier()
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MQTT WebSocket open timeout')), timeoutMs)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('MQTT WebSocket failed to open'))
    })
  })

  async function nextPacket(predicate: (packet: Uint8Array) => boolean, deadlineMs: number) {
    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline) {
      const foundIndex = queue.findIndex(predicate)
      if (foundIndex >= 0) {
        return queue.splice(foundIndex, 1)[0]
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          queueNotifier = null
          resolve()
        }, 50)

        queueNotifier = () => {
          clearTimeout(timeout)
          queueNotifier = null
          resolve()
        }
      })
    }

    throw new Error('Timed out waiting for MQTT packet')
  }

  try {
    const connectPacket = buildConnectPacket({
      clientId,
      username: input.username,
      password: input.password,
    })
    ws.send(connectPacket)

    const connAck = await nextPacket((packet) => packetType(packet) === CONNACK_PACKET_TYPE, timeoutMs)
    const returnCode = readConnAckReturnCode(connAck)
    if (returnCode !== 0) {
      throw new Error(`MQTT CONNACK rejected with code ${returnCode}`)
    }

    const packetId = Math.max(1, Math.floor(Math.random() * 65535))
    const publishPacket = buildPublishQos1Packet({
      topic: input.topic,
      payload: input.payload,
      packetId,
    })
    ws.send(publishPacket)

    await nextPacket(
      (packet) => packetType(packet) === PUBACK_PACKET_TYPE && readPubAckPacketId(packet) === packetId,
      timeoutMs,
    )

    ws.send(buildDisconnectPacket())
  } finally {
    try {
      ws.close()
    } catch {
      // noop
    }
  }
}

export async function readLwtSnapshotOverWs(input: {
  url: string
  deviceIds: string[]
  username?: string
  password?: string
  clientIdPrefix?: string
  timeoutMs?: number
  snapshotWaitMs?: number
}) {
  const deviceIds = Array.from(new Set(input.deviceIds.map((id) => id.trim()).filter(Boolean)))
  if (deviceIds.length === 0) {
    return {} as Record<string, string>
  }

  const timeoutMs = input.timeoutMs ?? 10_000
  const snapshotWaitMs = input.snapshotWaitMs ?? 600
  const clientId = `${input.clientIdPrefix ?? 'smartlamp-lwt'}-${crypto.randomUUID().slice(0, 8)}`
  const ws = new WebSocket(input.url, ['mqtt'])
  const expectedTopics = new Set(deviceIds.map((deviceId) => `home/${deviceId}/lwt`))
  const result: Record<string, string> = {}

  const queue: Uint8Array[] = []
  let queueNotifier: (() => void) | null = null
  let packetBuffer = new Uint8Array(0)

  ws.addEventListener('message', (event) => {
    void (async () => {
      const bytes = await toBytes(event.data)
      packetBuffer = concat(packetBuffer, bytes)
      while (true) {
        const pulled = pullOnePacket(packetBuffer)
        if (!pulled) {
          break
        }
        packetBuffer = pulled.rest
        queue.push(pulled.packet)
      }
      if (queueNotifier) {
        queueNotifier()
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MQTT WebSocket open timeout')), timeoutMs)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('MQTT WebSocket failed to open'))
    })
  })

  async function nextPacket(predicate: (packet: Uint8Array) => boolean, deadlineMs: number) {
    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline) {
      const foundIndex = queue.findIndex(predicate)
      if (foundIndex >= 0) {
        return queue.splice(foundIndex, 1)[0]
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          queueNotifier = null
          resolve()
        }, 50)

        queueNotifier = () => {
          clearTimeout(timeout)
          queueNotifier = null
          resolve()
        }
      })
    }

    throw new Error('Timed out waiting for MQTT packet')
  }

  try {
    ws.send(
      buildConnectPacket({
        clientId,
        username: input.username,
        password: input.password,
      }),
    )

    const connAck = await nextPacket((packet) => packetType(packet) === CONNACK_PACKET_TYPE, timeoutMs)
    const returnCode = readConnAckReturnCode(connAck)
    if (returnCode !== 0) {
      throw new Error(`MQTT CONNACK rejected with code ${returnCode}`)
    }

    const subscribePacketId = Math.max(1, Math.floor(Math.random() * 65535))
    ws.send(buildSubscribePacket(subscribePacketId, deviceIds.map((deviceId) => `home/${deviceId}/lwt`)))
    await nextPacket(
      (packet) => packetType(packet) === SUBACK_PACKET_TYPE && readSubAckPacketId(packet) === subscribePacketId,
      timeoutMs,
    )

    const snapshotDeadline = Date.now() + snapshotWaitMs
    while (Date.now() < snapshotDeadline) {
      const remaining = snapshotDeadline - Date.now()
      if (remaining <= 0) {
        break
      }

      let packet: Uint8Array
      try {
        packet = await nextPacket(() => true, Math.min(remaining, 200))
      } catch {
        break
      }

      if (packetType(packet) !== PUBLISH_PACKET_TYPE) {
        continue
      }

      const decoded = extractPublishPacket(packet)
      if (!decoded || !expectedTopics.has(decoded.topic)) {
        continue
      }

      const parts = decoded.topic.split('/')
      const deviceId = parts.length >= 3 ? parts[1] : ''
      if (!deviceId) {
        continue
      }

      result[deviceId] = decoded.payload
      if (Object.keys(result).length >= expectedTopics.size) {
        break
      }
    }

    ws.send(buildDisconnectPacket())
    return result
  } finally {
    try {
      ws.close()
    } catch {
      // noop
    }
  }
}

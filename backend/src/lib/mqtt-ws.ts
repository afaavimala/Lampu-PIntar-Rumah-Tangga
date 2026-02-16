const CONNECT_PACKET_TYPE = 0x10
const CONNACK_PACKET_TYPE = 0x20
const PUBLISH_QOS1_PACKET_TYPE = 0x32
const PUBACK_PACKET_TYPE = 0x40
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

function readPubAckPacketId(packet: Uint8Array) {
  if (packet.length < 4) return -1
  return (packet[2] << 8) | packet[3]
}

function readConnAckReturnCode(packet: Uint8Array) {
  if (packet.length < 4) return 255
  return packet[3]
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

  ws.addEventListener('message', (event) => {
    void (async () => {
      const bytes = await toBytes(event.data)
      queue.push(bytes)
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

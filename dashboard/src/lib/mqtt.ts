import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import type { BootstrapResponse, CommandEnvelope } from './types'

type RealtimeHandlers = {
  onStatus: (deviceId: string, payload: Record<string, unknown>) => void
  onLwt: (deviceId: string, payload: string) => void
  onError: (error: Error) => void
}

function extractDeviceId(topic: string) {
  const parts = topic.split('/')
  return parts.length >= 3 ? parts[1] : 'unknown-device'
}

function topicFor(pattern: string, deviceId: string) {
  return pattern.replace('{deviceId}', deviceId)
}

export function createRealtimeClient(
  mqttConfig: BootstrapResponse['mqtt'],
  deviceIds: string[],
  handlers: RealtimeHandlers,
) {
  const clientId = `${import.meta.env.VITE_MQTT_CLIENT_ID_PREFIX ?? mqttConfig.clientIdPrefix ?? 'smartlamp-web'}-${crypto
    .randomUUID()
    .slice(0, 8)}`

  const options: IClientOptions = {
    clientId,
    username: import.meta.env.VITE_MQTT_USERNAME || mqttConfig.username || undefined,
    password: import.meta.env.VITE_MQTT_PASSWORD || mqttConfig.password || undefined,
    reconnectPeriod: 2000,
    clean: true,
  }

  const wsUrl = import.meta.env.VITE_MQTT_WS_URL || mqttConfig.wsUrl
  const client = mqtt.connect(wsUrl, options)

  client.on('connect', () => {
    for (const deviceId of deviceIds) {
      client.subscribe(topicFor(mqttConfig.topics.status, deviceId), { qos: 1 })
      client.subscribe(topicFor(mqttConfig.topics.lwt, deviceId), { qos: 1 })
    }
  })

  client.on('message', (topic, payloadBuffer) => {
    const payloadText = payloadBuffer.toString('utf-8')
    const deviceId = extractDeviceId(topic)

    if (topic.endsWith('/status')) {
      try {
        handlers.onStatus(deviceId, JSON.parse(payloadText) as Record<string, unknown>)
      } catch {
        handlers.onStatus(deviceId, { raw: payloadText })
      }
      return
    }

    if (topic.endsWith('/lwt')) {
      handlers.onLwt(deviceId, payloadText)
    }
  })

  client.on('error', (error) => {
    handlers.onError(error)
  })

  function publishSignedCommand(envelope: CommandEnvelope) {
    return new Promise<void>((resolve, reject) => {
      const topic = topicFor(mqttConfig.topics.command, envelope.deviceId)
      client.publish(topic, JSON.stringify(envelope), { qos: 1, retain: false }, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  function disconnect() {
    return new Promise<void>((resolve) => {
      client.end(true, {}, () => resolve())
    })
  }

  function resubscribe(newDeviceIds: string[]) {
    if (!client.connected) {
      return
    }

    for (const deviceId of newDeviceIds) {
      client.subscribe(topicFor(mqttConfig.topics.status, deviceId), { qos: 1 })
      client.subscribe(topicFor(mqttConfig.topics.lwt, deviceId), { qos: 1 })
    }
  }

  return {
    client,
    publishSignedCommand,
    disconnect,
    resubscribe,
  }
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>
export type RealtimeMqttClient = MqttClient

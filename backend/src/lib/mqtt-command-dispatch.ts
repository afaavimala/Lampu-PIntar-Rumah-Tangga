import type { EnvBindings } from '../types/app'
import type { CommandDispatchEnvelope } from './commands'
import { publishCompatibleCommandOverWs } from './mqtt-command-publish'
import { getRealtimeMqttProxy } from './realtime-mqtt-proxy'

const MQTT_GATEWAY_OBJECT_NAME = 'mqtt-gateway-singleton'
const MQTT_GATEWAY_PUBLISH_PATH = '/publish'

type DurableObjectErrorPayload = {
  message?: string
  error?: {
    message?: string
  }
}

async function publishViaDurableObject(env: EnvBindings, envelope: CommandDispatchEnvelope) {
  const namespace = env.MQTT_GATEWAY
  if (!namespace) {
    return false
  }

  const objectId = namespace.idFromName(MQTT_GATEWAY_OBJECT_NAME)
  const objectStub = namespace.get(objectId)
  const response = await objectStub.fetch(`https://mqtt-gateway.internal${MQTT_GATEWAY_PUBLISH_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(envelope),
  })

  if (response.ok) {
    return true
  }

  let message = `MQTT gateway publish failed (${response.status})`
  try {
    const payload = (await response.json()) as DurableObjectErrorPayload
    message = payload.error?.message ?? payload.message ?? message
  } catch {
    // ignore non-json error payload
  }

  throw new Error(message)
}

export async function publishCommandPersistent(env: EnvBindings, envelope: CommandDispatchEnvelope) {
  const publishedViaDo = await publishViaDurableObject(env, envelope)
  if (publishedViaDo) {
    return
  }

  const proxy = getRealtimeMqttProxy()
  if (proxy) {
    await proxy.publishCommand(envelope)
    return
  }

  await publishCompatibleCommandOverWs(
    {
      url: env.MQTT_WS_URL,
      username: env.MQTT_USERNAME,
      password: env.MQTT_PASSWORD,
      clientIdPrefix: env.MQTT_CLIENT_ID_PREFIX,
    },
    envelope,
  )
}

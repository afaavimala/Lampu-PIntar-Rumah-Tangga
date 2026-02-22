import type { SignedCommandEnvelope } from './commands'
import { buildCommandPublishTargets } from './mqtt-compat'
import { publishMqttOverWs } from './mqtt-ws'

type PublishConfig = {
  url: string
  username?: string
  password?: string
  clientIdPrefix?: string
}

export async function publishCompatibleCommandOverWs(
  config: PublishConfig,
  envelope: SignedCommandEnvelope,
) {
  const targets = buildCommandPublishTargets({
    deviceId: envelope.deviceId,
    action: envelope.action,
    envelopeJson: JSON.stringify(envelope),
  })

  const errors: string[] = []
  let succeeded = 0

  for (const target of targets) {
    try {
      await publishMqttOverWs({
        url: config.url,
        username: config.username,
        password: config.password,
        clientIdPrefix: config.clientIdPrefix,
        topic: target.topic,
        payload: target.payload,
      })
      succeeded += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${target.topic}: ${message}`)
    }
  }

  if (succeeded > 0) {
    return
  }

  const details = errors.join('; ') || 'unknown publish error'
  throw new Error(`Failed to publish command on all MQTT topic profiles (${details})`)
}

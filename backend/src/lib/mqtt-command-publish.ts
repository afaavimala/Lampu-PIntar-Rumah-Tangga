import type { CommandDispatchEnvelope } from './commands'
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
  envelope: CommandDispatchEnvelope,
) {
  const targets = buildCommandPublishTargets({
    deviceId: envelope.deviceId,
    action: envelope.action,
  })

  const publishResults = await Promise.allSettled(
    targets.map((target) =>
      publishMqttOverWs({
        url: config.url,
        username: config.username,
        password: config.password,
        clientIdPrefix: config.clientIdPrefix,
        topic: target.topic,
        payload: target.payload,
      }),
    ),
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

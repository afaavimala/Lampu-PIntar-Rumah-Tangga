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
    commandChannel: envelope.commandChannel,
  })

  const target = targets[0]
  if (!target) {
    throw new Error('No MQTT publish target resolved')
  }

  try {
    await publishMqttOverWs({
      url: config.url,
      username: config.username,
      password: config.password,
      clientIdPrefix: config.clientIdPrefix,
      topic: target.topic,
      payload: target.payload,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to publish MQTT command (${target.topic}: ${message})`)
  }
}

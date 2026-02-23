import { MqttGatewayDurableObject } from '../durable/mqtt-gateway-object'
import type { EnvBindings } from '../types/app'

type LocalDurableObjectStub = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

type LocalDurableObjectNamespace = {
  idFromName: (name: string) => string
  get: (id: unknown) => LocalDurableObjectStub
}

export function createLocalMqttGatewayNamespace(env: EnvBindings): LocalDurableObjectNamespace {
  const objectMap = new Map<string, MqttGatewayDurableObject>()

  function ensureObject(id: string) {
    const existing = objectMap.get(id)
    if (existing) {
      return existing
    }

    const instance = new MqttGatewayDurableObject({}, env)
    objectMap.set(id, instance)
    return instance
  }

  return {
    idFromName(name: string) {
      return name
    },
    get(id: unknown) {
      const objectId = String(id)
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          const request =
            input instanceof Request
              ? input
              : new Request(input instanceof URL ? input.toString() : String(input), init)
          return ensureObject(objectId).fetch(request)
        },
      }
    },
  }
}

import { createApp } from './app'
import { runDueSchedules } from './lib/scheduler-runner'
import type { EnvBindings } from './types/app'

type WorkerExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void
}

const app = createApp()

export { createApp }

export default {
  fetch: app.fetch,
  scheduled: async (_event: unknown, env: EnvBindings, ctx: WorkerExecutionContext) => {
    ctx.waitUntil(
      runDueSchedules(env)
        .then((result) => {
          console.log('Scheduler tick completed', result)
        })
        .catch((error) => {
          console.error('Scheduler tick failed', error)
        }),
    )
  },
}

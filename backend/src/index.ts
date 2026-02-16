import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './routes/auth'
import { bootstrapRoutes } from './routes/bootstrap'
import { commandRoutes } from './routes/commands'
import { scheduleRoutes } from './routes/schedules'
import { statusRoutes } from './routes/status'
import { integrationRoutes } from './routes/integrations'
import { openApiRoutes } from './routes/openapi'
import { requestIdMiddleware } from './middleware/request-id'
import { authResolverMiddleware } from './middleware/auth'
import { fail, ok } from './lib/response'
import { runDueSchedules } from './lib/scheduler-runner'
import type { AppEnv, EnvBindings } from './types/app'

const app = new Hono<AppEnv>()

app.use('*', requestIdMiddleware)
app.use('/api/*', cors({
  origin: (origin, c) => {
    const configuredOrigins = (c.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((item: string) => item.trim())
      .filter(Boolean)
    const allowedOrigins =
      configuredOrigins.length > 0
        ? configuredOrigins
        : ['http://127.0.0.1:5173', 'http://localhost:5173']

    if (!origin) {
      return allowedOrigins[0] ?? 'http://127.0.0.1:5173'
    }

    return allowedOrigins.includes(origin) ? origin : ''
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: [
    'X-Request-Id',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
  maxAge: 600,
}))
app.use('*', authResolverMiddleware)

app.onError((error, c) => {
  console.error('Unhandled error', error)
  return fail(c, 'INTERNAL_ERROR', 'Internal server error', 500)
})

app.get('/', (c) => {
  return ok(c, {
    name: 'smartlamp-backend',
    status: 'ok',
  })
})

app.route('/api/v1/auth', authRoutes)
app.route('/api/v1/bootstrap', bootstrapRoutes)
app.route('/api/v1/commands', commandRoutes)
app.route('/api/v1/schedules', scheduleRoutes)
app.route('/api/v1/status', statusRoutes)
app.route('/api/v1', integrationRoutes)
app.route('/api/v1', openApiRoutes)

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledEvent, env: EnvBindings, ctx: ExecutionContext) => {
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

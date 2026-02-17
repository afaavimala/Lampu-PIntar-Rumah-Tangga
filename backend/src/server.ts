import { access, readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createMariaDatabase, createMariaPool } from './lib/mariadb-d1'
import { loadServerRuntimeConfig } from './lib/runtime-env'
import { runDueSchedules } from './lib/scheduler-runner'
import { initializeRealtimeMqttProxy, shutdownRealtimeMqttProxy } from './lib/realtime-mqtt-proxy'
import type { EnvBindings } from './types/app'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function normalizeStaticPath(pathname: string) {
  if (!pathname || pathname === '/') {
    return '/index.html'
  }
  return pathname
}

function resolveStaticFile(baseDir: string, pathname: string) {
  const normalized = normalizeStaticPath(pathname)
  const target = resolve(baseDir, `.${normalized}`)
  const base = resolve(baseDir)
  if (target === base || target.startsWith(`${base}${sep}`)) {
    return target
  }
  return null
}

async function readStaticResponse(filePath: string) {
  await access(filePath)
  const body = await readFile(filePath)
  const extension = extname(filePath).toLowerCase()
  return new Response(body, {
    headers: {
      'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    },
  })
}

async function createFrontendResponse(frontendDistDir: string, requestPath: string) {
  const requestedFile = resolveStaticFile(frontendDistDir, requestPath)
  if (!requestedFile) {
    return null
  }
  const requestLooksLikeAsset = extname(requestedFile).length > 0 && !requestPath.endsWith('/')

  try {
    return await readStaticResponse(requestedFile)
  } catch {
    if (requestLooksLikeAsset) {
      return null
    }
    const indexPath = resolveStaticFile(frontendDistDir, '/index.html')
    if (!indexPath) return null
    try {
      return await readStaticResponse(indexPath)
    } catch {
      return null
    }
  }
}

async function main() {
  const config = loadServerRuntimeConfig(process.env)
  const pool = createMariaPool(config.db)
  const db = createMariaDatabase(pool)
  const bindings: EnvBindings = {
    DB: db,
    ...config.bindings,
  }

  initializeRealtimeMqttProxy({
    url: config.bindings.MQTT_WS_URL,
    username: config.bindings.MQTT_USERNAME,
    password: config.bindings.MQTT_PASSWORD,
    clientIdPrefix: config.bindings.MQTT_CLIENT_ID_PREFIX,
  })

  const app = createApp()

  if (config.serveDashboard) {
    app.use('*', async (c, next) => {
      if (c.req.path.startsWith('/api/')) {
        return next()
      }
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
        return next()
      }
      const staticResponse = await createFrontendResponse(config.frontendDistDir, c.req.path)
      if (staticResponse) {
        return staticResponse
      }
      return next()
    })
  }

  let schedulerLocked = false
  const runSchedulerTick = async () => {
    if (schedulerLocked) {
      return
    }

    schedulerLocked = true
    try {
      const result = await runDueSchedules(bindings)
      console.log('[scheduler] tick completed', result)
    } catch (error) {
      console.error('[scheduler] tick failed', error)
    } finally {
      schedulerLocked = false
    }
  }

  let timer: NodeJS.Timeout | null = null
  if (config.schedulerEnabled) {
    timer = setInterval(() => {
      void runSchedulerTick()
    }, config.schedulerIntervalMs)
    void runSchedulerTick()
  }

  const server = serve({
    port: config.port,
    fetch: (request) => app.fetch(request, bindings),
  })

  console.log(`[server] Running on http://127.0.0.1:${config.port}`)
  if (config.serveDashboard) {
    console.log(`[server] Serving frontend from ${config.frontendDistDir}`)
  }

  const shutdown = async () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }

    shutdownRealtimeMqttProxy()

    await new Promise<void>((resolveShutdown) => {
      server.close(() => resolveShutdown())
    })
    await pool.end()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown()
  })
  process.on('SIGTERM', () => {
    void shutdown()
  })
}

void main().catch((error) => {
  console.error('[server] Fatal error while starting server', error)
  process.exit(1)
})

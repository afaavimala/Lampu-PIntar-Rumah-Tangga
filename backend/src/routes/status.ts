import { Hono } from 'hono'
import type { AppEnv } from '../types/app'
import { requireAuth } from '../middleware/auth'
import { fail, ok } from '../lib/response'
import { listBestStatus } from '../lib/status'

export const statusRoutes = new Hono<AppEnv>()

statusRoutes.get('/', requireAuth(['read']), async (c) => {
  const principal = c.get('principal')
  if (!principal) {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const statuses = await listBestStatus(c.env.DB, principal)
  return ok(c, statuses)
})

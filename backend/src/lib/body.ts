import type { Context } from 'hono'
import type { ZodType } from 'zod'
import type { AppEnv } from '../types/app'

type ParseResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; message: string; details?: unknown }

export async function parseJsonBody<T>(
  c: Context<AppEnv>,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  const raw = await c.req.text()
  if (!raw) {
    return { ok: false, message: 'Request body is required' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, message: 'Invalid JSON body' }
  }

  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    return {
      ok: false,
      message: 'Validation failed',
      details: validated.error.flatten(),
    }
  }

  return { ok: true, data: validated.data, raw }
}

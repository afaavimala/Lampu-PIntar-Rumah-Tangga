import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types/app'
import { parseJsonBody } from '../lib/body'
import { getUserByEmail, getUserById, updateUserProfile } from '../lib/db'
import { hashPassword, verifyPassword } from '../lib/password'
import { fail, ok } from '../lib/response'
import { requireUserAuth } from '../middleware/auth'

const updateProfileSchema = z
  .object({
    email: z.email().optional(),
    currentPassword: z.string().min(8).max(128).optional(),
    newPassword: z.string().min(8).max(128).optional(),
  })
  .refine((value) => value.email !== undefined || value.newPassword !== undefined, {
    message: 'At least one editable field is required',
  })
  .refine((value) => value.newPassword === undefined || value.currentPassword !== undefined, {
    message: 'Current password is required to set a new password',
  })

export const profileRoutes = new Hono<AppEnv>()

function toProfileDto(user: {
  id: number
  email: string
  role: string
  is_active: number
  created_at: string
  updated_at: string | null
}) {
  return {
    id: Number(user.id),
    email: user.email,
    role: user.role,
    isActive: Number(user.is_active) === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  }
}

profileRoutes.get('/profile', requireUserAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'User authentication required', 401)
  }

  const user = await getUserById(c.env.DB, principal.userId, c.env.SEED_ADMIN_EMAIL)
  if (!user || user.is_active !== 1) {
    return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid user', 401)
  }
  return ok(c, toProfileDto(user))
})

profileRoutes.patch('/profile', requireUserAuth(), async (c) => {
  const principal = c.get('principal')
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'User authentication required', 401)
  }

  const parsed = await parseJsonBody(c, updateProfileSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const user = await getUserById(c.env.DB, principal.userId, c.env.SEED_ADMIN_EMAIL)
  if (!user || user.is_active !== 1) {
    return fail(c, 'AUTH_INVALID_TOKEN', 'Invalid user', 401)
  }

  if (parsed.data.email && parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
    const existing = await getUserByEmail(c.env.DB, parsed.data.email)
    if (existing) {
      return fail(c, 'VALIDATION_ERROR', 'Email already exists', 409)
    }
  }

  let passwordHash: string | undefined
  if (parsed.data.newPassword) {
    const verification = await verifyPassword(parsed.data.currentPassword ?? '', user.password_hash)
    if (!verification.ok) {
      return fail(c, 'AUTH_INVALID_TOKEN', 'Current password is invalid', 401)
    }
    passwordHash = await hashPassword(parsed.data.newPassword)
  }

  await updateUserProfile(c.env.DB, principal.userId, {
    email: parsed.data.email,
    passwordHash,
  })

  const updated = await getUserById(c.env.DB, principal.userId, c.env.SEED_ADMIN_EMAIL)
  if (!updated) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  return ok(c, toProfileDto(updated))
})

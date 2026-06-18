import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv, DevicePermission, SchedulePermission } from '../types/app'
import { parseJsonBody } from '../lib/body'
import {
  archiveUserByAdmin,
  canManageSchedulesForAssignment,
  createUser,
  getUserByEmail,
  getUserById,
  listAllDevices,
  listUserDeviceAssignments,
  listUsers,
  replaceUserDeviceAssignments,
  restoreUserByAdmin,
  updateUserByAdmin,
} from '../lib/db'
import { hashPassword } from '../lib/password'
import { fail, ok } from '../lib/response'
import { requireAdminUser } from '../middleware/auth'

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.email(),
  password: z.string().min(8).max(128),
  isActive: z.boolean().optional().default(true),
})

const patchUserSchema = z
  .object({
    email: z.email().optional(),
    name: z.string().trim().min(1).max(255).optional(),
    password: z.string().min(8).max(128).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.password !== undefined ||
      value.isActive !== undefined,
    {
      message: 'At least one editable field is required',
    },
  )

const assignmentSchema = z.object({
  deviceId: z.string().min(1),
  assigned: z.boolean().optional().default(true),
  devicePermission: z.enum(['monitoring', 'control', 'manage']).default('monitoring'),
  schedulePermission: z.enum(['none', 'monitoring', 'manage']).default('none'),
})

const replaceAssignmentsSchema = z.object({
  assignments: z.array(assignmentSchema).max(500),
})

export const userRoutes = new Hono<AppEnv>()

function toUserDto(user: {
  id: number
  email: string
  name: string
  role: string
  is_active: number
  created_at: string
  updated_at: string | null
  deleted_at: string | null
  deleted_by_user_id: number | null
}) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: Number(user.is_active) === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    deletedAt: user.deleted_at,
    deletedByUserId:
      user.deleted_by_user_id == null ? null : Number(user.deleted_by_user_id),
    isArchived: user.deleted_at != null,
  }
}

userRoutes.get('/users', requireAdminUser(), async (c) => {
  const includeArchived = ['1', 'true', 'yes'].includes(
    (c.req.query('includeArchived') ?? '').trim().toLowerCase(),
  )
  const users = await listUsers(c.env.DB, { includeArchived })
  return ok(c, users.map(toUserDto))
})

userRoutes.post('/users', requireAdminUser(), async (c) => {
  const parsed = await parseJsonBody(c, createUserSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const existing = await getUserByEmail(c.env.DB, parsed.data.email)
  if (existing) {
    return fail(c, 'VALIDATION_ERROR', 'Email already exists', 409)
  }

  const userId = await createUser(c.env.DB, {
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    role: 'member',
    isActive: parsed.data.isActive,
  })
  const user = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!user) {
    return fail(c, 'INTERNAL_ERROR', 'Failed to create user', 500)
  }

  return ok(c, toUserDto(user), 201)
})

userRoutes.patch('/users/:userId', requireAdminUser(), async (c) => {
  const principal = c.get('principal')
  const userId = Number(c.req.param('userId'))
  if (Number.isNaN(userId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid userId', 400)
  }

  const parsed = await parseJsonBody(c, patchUserSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const target = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!target) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  if (target.deleted_at != null) {
    return fail(c, 'VALIDATION_ERROR', 'Archived user must be restored before editing', 400)
  }

  if (parsed.data.email && parsed.data.email.toLowerCase() !== target.email.toLowerCase()) {
    const existing = await getUserByEmail(c.env.DB, parsed.data.email)
    if (existing) {
      return fail(c, 'VALIDATION_ERROR', 'Email already exists', 409)
    }
  }

  const isSelf = principal?.kind === 'user' && target.id === principal.userId
  if (parsed.data.isActive === false && (target.role === 'admin' || isSelf)) {
    return fail(c, 'VALIDATION_ERROR', 'Admin user cannot be deactivated', 400)
  }

  await updateUserByAdmin(c.env.DB, userId, {
    email: parsed.data.email,
    passwordHash: parsed.data.password ? await hashPassword(parsed.data.password) : undefined,
    name: parsed.data.name,
    isActive: parsed.data.isActive,
  })

  const updated = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!updated) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  return ok(c, toUserDto(updated))
})

userRoutes.delete('/users/:userId', requireAdminUser(), async (c) => {
  const principal = c.get('principal')
  const userId = Number(c.req.param('userId'))
  if (Number.isNaN(userId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid userId', 400)
  }
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const target = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!target) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  if (target.role === 'admin' || target.id === principal.userId) {
    return fail(c, 'VALIDATION_ERROR', 'Admin user cannot be archived', 400)
  }

  await archiveUserByAdmin(c.env.DB, {
    userId,
    actorUserId: principal.userId,
  })

  const updated = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!updated) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  return ok(c, toUserDto(updated))
})

userRoutes.post('/users/:userId/restore', requireAdminUser(), async (c) => {
  const userId = Number(c.req.param('userId'))
  if (Number.isNaN(userId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid userId', 400)
  }

  const target = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!target) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  if (target.role !== 'member') {
    return fail(c, 'VALIDATION_ERROR', 'Only member users can be restored', 400)
  }

  await restoreUserByAdmin(c.env.DB, userId)
  const updated = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!updated) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  return ok(c, toUserDto(updated))
})

userRoutes.get('/users/:userId/assignments', requireAdminUser(), async (c) => {
  const userId = Number(c.req.param('userId'))
  if (Number.isNaN(userId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid userId', 400)
  }

  const target = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!target) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }

  const [devices, assignments] = await Promise.all([
    listAllDevices(c.env.DB),
    listUserDeviceAssignments(c.env.DB, userId),
  ])
  const assignmentByDeviceId = new Map(assignments.map((item) => [item.public_device_id, item]))

  return ok(c, {
    user: toUserDto(target),
    assignments: devices.map((device) => {
      const assignment = assignmentByDeviceId.get(device.device_id)
      return {
        deviceId: device.device_id,
        name: device.name,
        location: device.location,
        commandChannel: device.command_channel,
        assigned: !!assignment,
        devicePermission: assignment?.device_permission ?? 'monitoring',
        schedulePermission: assignment?.schedule_permission ?? 'none',
      }
    }),
  })
})

userRoutes.put('/users/:userId/assignments', requireAdminUser(), async (c) => {
  const principal = c.get('principal')
  const userId = Number(c.req.param('userId'))
  if (Number.isNaN(userId)) {
    return fail(c, 'VALIDATION_ERROR', 'Invalid userId', 400)
  }
  if (!principal || principal.kind !== 'user') {
    return fail(c, 'NOT_AUTHENTICATED', 'Authentication required', 401)
  }

  const parsed = await parseJsonBody(c, replaceAssignmentsSchema)
  if (!parsed.ok) {
    return fail(c, 'VALIDATION_ERROR', parsed.message, 400, { details: parsed.details })
  }

  const target = await getUserById(c.env.DB, userId, c.env.SEED_ADMIN_EMAIL)
  if (!target) {
    return fail(c, 'USER_NOT_FOUND', 'User not found', 404)
  }
  if (target.role !== 'member') {
    return fail(c, 'VALIDATION_ERROR', 'Only member users can receive assignments', 400)
  }
  if (target.deleted_at != null) {
    return fail(c, 'VALIDATION_ERROR', 'Archived user must be restored before assignment', 400)
  }

  const devices = await listAllDevices(c.env.DB)
  const deviceByPublicId = new Map(devices.map((device) => [device.device_id, device]))
  const seenDeviceIds = new Set<string>()
  const assignments: Array<{
    deviceInternalId: number
    devicePermission: DevicePermission
    schedulePermission: SchedulePermission
  }> = []

  for (const assignment of parsed.data.assignments) {
    if (!assignment.assigned) {
      continue
    }
    if (seenDeviceIds.has(assignment.deviceId)) {
      return fail(c, 'VALIDATION_ERROR', 'Duplicate device assignment', 400, {
        deviceId: assignment.deviceId,
      })
    }
    seenDeviceIds.add(assignment.deviceId)

    const device = deviceByPublicId.get(assignment.deviceId)
    if (!device) {
      return fail(c, 'DEVICE_NOT_FOUND', 'Device not found', 404, {
        deviceId: assignment.deviceId,
      })
    }

    const devicePermission = assignment.devicePermission as DevicePermission
    const schedulePermission = assignment.schedulePermission as SchedulePermission
    if (
      schedulePermission === 'manage' &&
      !canManageSchedulesForAssignment({ devicePermission, schedulePermission })
    ) {
      return fail(
        c,
        'VALIDATION_ERROR',
        'Schedule manage requires device control or manage permission',
        400,
        { deviceId: assignment.deviceId },
      )
    }

    assignments.push({
      deviceInternalId: device.id,
      devicePermission,
      schedulePermission,
    })
  }

  await replaceUserDeviceAssignments(c.env.DB, {
    targetUserId: userId,
    actorUserId: principal.userId,
    assignments,
  })

  const updatedAssignments = await listUserDeviceAssignments(c.env.DB, userId)
  return ok(c, {
    userId,
    assignments: updatedAssignments.map((assignment) => ({
      deviceId: assignment.public_device_id,
      assigned: true,
      devicePermission: assignment.device_permission,
      schedulePermission: assignment.schedule_permission,
    })),
  })
})

import { Hono } from 'hono'
import type { AppEnv } from '../types/app'

export const openApiRoutes = new Hono<AppEnv>()

openApiRoutes.get('/openapi.json', (c) => {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'SmartLamp IoT API',
      version: 'v1',
      description: 'Open integration API for SmartLamp IoT system',
    },
    servers: [{ url: '/' }],
    paths: {
      '/api/v1/auth/login': { post: { summary: 'Login user' } },
      '/api/v1/auth/refresh': { post: { summary: 'Refresh access token and rotate refresh session' } },
      '/api/v1/auth/logout': { post: { summary: 'Logout user' } },
      '/api/v1/profile': {
        get: {
          summary: 'Get current user profile with role',
          responses: {
            200: { description: 'Current user profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserSummaryEnvelope' } } } },
          },
        },
        patch: {
          summary: 'Update current user name/email/password',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProfilePatch' } } } },
          responses: {
            200: { description: 'Updated profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserSummaryEnvelope' } } } },
          },
        },
      },
      '/api/v1/users': {
        get: {
          summary: 'Admin: list users',
          parameters: [
            {
              name: 'includeArchived',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['1', 'true', 'yes'] },
              description: 'Include soft-deleted/archived member users when truthy.',
            },
          ],
        },
        post: {
          summary: 'Admin: create member user',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserRequest' } } } },
        },
      },
      '/api/v1/users/{userId}': {
        patch: {
          summary: 'Admin: update member name/email/password/status',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PatchUserRequest' } } } },
        },
        delete: {
          summary: 'Admin: archive member user',
          description: 'Soft delete only: sets deletedAt and disables login without removing historical schedules/logs.',
        },
      },
      '/api/v1/users/{userId}/restore': {
        post: {
          summary: 'Admin: restore archived member user',
          description: 'Clears deletedAt and reactivates the member. Assignments are retained.',
        },
      },
      '/api/v1/users/{userId}/assignments': {
        get: { summary: 'Admin: list member device/schedule assignments' },
        put: {
          summary: 'Admin: replace member device/schedule assignments',
          description: 'schedulePermission=manage requires devicePermission control or manage.',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ReplaceAssignmentsRequest' } } } },
        },
      },
      '/api/v1/bootstrap': { get: { summary: 'Bootstrap dashboard session' } },
      '/api/v1/commands/execute': { post: { summary: 'Publish command via backend proxy' } },
      '/api/v1/status': { get: { summary: 'Fallback status list' } },
      '/api/v1/realtime/stream': { get: { summary: 'Realtime stream (SSE proxy from backend)' } },
      '/api/v1/schedules': {
        get: {
          summary: 'List schedules',
          description: 'Members only see schedules for assigned devices with schedule monitoring/manage permission.',
          responses: {
            200: { description: 'Schedules', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduleListEnvelope' } } } },
          },
        },
        post: {
          summary: 'Create schedule',
          description: 'Window schedules use HH:mm in UI, but API window fields are stored as seconds for backward-compatible field names.',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateScheduleRequest' } } } },
          responses: {
            201: { description: 'Created schedule', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduleEnvelope' } } } },
          },
        },
      },
      '/api/v1/schedules/{scheduleId}': {
        get: { summary: 'Get schedule detail' },
        patch: {
          summary: 'Update schedule',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PatchScheduleRequest' } } } },
        },
        delete: { summary: 'Delete schedule' },
      },
      '/api/v1/schedules/{scheduleId}/runs': {
        get: { summary: 'List schedule execution runs' },
      },
      '/api/v1/integrations/capabilities': {
        get: { summary: 'Get integration capabilities' },
      },
      '/api/v1/devices': {
        get: { summary: 'List devices' },
        post: { summary: 'Create device and attach to current user' },
      },
      '/api/v1/devices/discovery': {
        get: { summary: 'Scan broker topics and discover available Tasmota devices' },
      },
      '/api/v1/devices/{deviceId}': {
        get: { summary: 'Get device detail' },
        patch: { summary: 'Update device profile (name/location/command channel)' },
        delete: { summary: 'Detach device from current user and disable user schedules for it' },
      },
      '/api/v1/devices/{deviceId}/status': {
        get: { summary: 'Get fallback status for a device' },
      },
      '/api/v1/openapi.json': {
        get: { summary: 'OpenAPI document' },
      },
    },
    components: {
      schemas: {
        ApiEnvelopeBase: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: ['object', 'null'] },
            meta: { type: 'object' },
          },
          required: ['success', 'error', 'meta'],
        },
        UserRole: { type: 'string', enum: ['admin', 'member'] },
        DevicePermission: { type: 'string', enum: ['monitoring', 'control', 'manage'] },
        SchedulePermission: { type: 'string', enum: ['none', 'monitoring', 'manage'] },
        UserSummary: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { $ref: '#/components/schemas/UserRole' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string' },
            updatedAt: { type: ['string', 'null'] },
            deletedAt: { type: ['string', 'null'] },
            deletedByUserId: { type: ['integer', 'null'] },
            isArchived: { type: 'boolean' },
          },
          required: [
            'id',
            'name',
            'email',
            'role',
            'isActive',
            'createdAt',
            'updatedAt',
            'deletedAt',
            'deletedByUserId',
            'isArchived',
          ],
        },
        UserSummaryEnvelope: {
          allOf: [
            { $ref: '#/components/schemas/ApiEnvelopeBase' },
            {
              type: 'object',
              properties: {
                data: { $ref: '#/components/schemas/UserSummary' },
              },
              required: ['data'],
            },
          ],
        },
        ProfilePatch: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            email: { type: 'string', format: 'email' },
            currentPassword: { type: 'string', minLength: 8, maxLength: 128 },
            newPassword: { type: 'string', minLength: 8, maxLength: 128 },
          },
        },
        CreateUserRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
            isActive: { type: 'boolean', default: true },
          },
          required: ['name', 'email', 'password'],
        },
        PatchUserRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8, maxLength: 128 },
            isActive: { type: 'boolean' },
          },
        },
        UserAssignment: {
          type: 'object',
          properties: {
            deviceId: { type: 'string' },
            name: { type: 'string' },
            location: { type: ['string', 'null'] },
            commandChannel: { type: 'string' },
            assigned: { type: 'boolean' },
            devicePermission: { $ref: '#/components/schemas/DevicePermission' },
            schedulePermission: { $ref: '#/components/schemas/SchedulePermission' },
          },
          required: ['deviceId', 'name', 'location', 'commandChannel', 'assigned', 'devicePermission', 'schedulePermission'],
        },
        ReplaceAssignmentsRequest: {
          type: 'object',
          properties: {
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string' },
                  assigned: { type: 'boolean' },
                  devicePermission: { $ref: '#/components/schemas/DevicePermission' },
                  schedulePermission: { $ref: '#/components/schemas/SchedulePermission' },
                },
                required: ['deviceId', 'assigned', 'devicePermission', 'schedulePermission'],
              },
            },
          },
          required: ['assignments'],
        },
        Device: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            location: { type: ['string', 'null'] },
            commandChannel: { type: 'string' },
            devicePermission: { $ref: '#/components/schemas/DevicePermission' },
            schedulePermission: { $ref: '#/components/schemas/SchedulePermission' },
          },
          required: ['id', 'name', 'location', 'commandChannel', 'devicePermission', 'schedulePermission'],
        },
        ScheduleRule: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            userEmail: { type: ['string', 'null'], format: 'email' },
            createdByUserId: { type: ['integer', 'null'] },
            deviceId: { type: 'string' },
            action: { type: 'string', enum: ['ON', 'OFF'] },
            cron: {
              type: 'string',
              description: 'Five-field cron is accepted. Six-field cron enables seconds; window schedules generated by the dashboard use six fields.',
              examples: ['* * * * * *', '*/5 * * * * *'],
            },
            timezone: { type: 'string', examples: ['Asia/Jakarta'] },
            enabled: { type: 'boolean' },
            nextRunAt: { type: 'integer', description: 'Unix epoch milliseconds.' },
            lastRunAt: { type: ['integer', 'null'], description: 'Unix epoch milliseconds.' },
            startAt: { type: ['integer', 'null'], description: 'Unix epoch milliseconds.' },
            endAt: { type: ['integer', 'null'], description: 'Unix epoch milliseconds.' },
            windowGroupId: { type: ['string', 'null'] },
            windowStartMinute: {
              type: ['integer', 'null'],
              minimum: 0,
              maximum: 86399,
              description: 'Backward-compatible field name. Value is seconds since 00:00:00.',
            },
            windowEndMinute: {
              type: ['integer', 'null'],
              minimum: 0,
              maximum: 86399,
              description: 'Backward-compatible field name. Value is seconds since 00:00:00. Window end is exclusive.',
            },
            enforceEveryMinute: {
              type: ['integer', 'null'],
              minimum: 1,
              maximum: 86400,
              description: 'Backward-compatible field name. Value is interval seconds, displayed by the dashboard as mm:ss.',
            },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        ScheduleEnvelope: {
          allOf: [
            { $ref: '#/components/schemas/ApiEnvelopeBase' },
            {
              type: 'object',
              properties: {
                data: { $ref: '#/components/schemas/ScheduleRule' },
              },
              required: ['data'],
            },
          ],
        },
        ScheduleListEnvelope: {
          allOf: [
            { $ref: '#/components/schemas/ApiEnvelopeBase' },
            {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ScheduleRule' },
                },
              },
              required: ['data'],
            },
          ],
        },
        ScheduleWindowFields: {
          type: 'object',
          description: 'Optional window enforcement fields. If one window field is sent, all four window fields must be sent.',
          properties: {
            windowGroupId: { type: 'string' },
            windowStartMinute: {
              type: 'integer',
              minimum: 0,
              maximum: 86399,
              description: 'Backward-compatible field name. Send seconds since 00:00:00.',
            },
            windowEndMinute: {
              type: 'integer',
              minimum: 0,
              maximum: 86399,
              description: 'Backward-compatible field name. Send seconds since 00:00:00. End is exclusive.',
            },
            enforceEveryMinute: {
              type: 'integer',
              minimum: 1,
              maximum: 86400,
              description: 'Backward-compatible field name. Send interval seconds.',
            },
          },
        },
        CreateScheduleRequest: {
          allOf: [
            {
              type: 'object',
              properties: {
                targetUserId: { type: 'integer', description: 'Admin-only. Create schedule for another user.' },
                deviceId: { type: 'string' },
                action: { type: 'string', enum: ['ON', 'OFF'] },
                cron: { type: 'string', examples: ['* * * * * *', '*/5 * * * * *'] },
                timezone: { type: 'string', examples: ['Asia/Jakarta'] },
                enabled: { type: 'boolean', default: true },
                startAt: { type: 'string', format: 'date-time' },
                endAt: { type: 'string', format: 'date-time' },
              },
              required: ['deviceId', 'action', 'cron', 'timezone'],
            },
            { $ref: '#/components/schemas/ScheduleWindowFields' },
          ],
        },
        PatchScheduleRequest: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['ON', 'OFF'] },
            cron: { type: 'string', examples: ['* * * * * *', '*/5 * * * * *'] },
            timezone: { type: 'string', examples: ['Asia/Jakarta'] },
            enabled: { type: 'boolean' },
            startAt: { type: ['string', 'null'], format: 'date-time' },
            endAt: { type: ['string', 'null'], format: 'date-time' },
            windowGroupId: { type: ['string', 'null'] },
            windowStartMinute: {
              type: ['integer', 'null'],
              minimum: 0,
              maximum: 86399,
              description: 'Backward-compatible field name. Send seconds since 00:00:00.',
            },
            windowEndMinute: {
              type: ['integer', 'null'],
              minimum: 0,
              maximum: 86399,
              description: 'Backward-compatible field name. Send seconds since 00:00:00.',
            },
            enforceEveryMinute: {
              type: ['integer', 'null'],
              minimum: 1,
              maximum: 86400,
              description: 'Backward-compatible field name. Send interval seconds.',
            },
          },
        },
      },
    },
  }

  return c.json(spec)
})

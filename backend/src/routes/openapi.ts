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
          summary: 'Update current user email/password',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProfilePatch' } } } },
          responses: {
            200: { description: 'Updated profile', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserSummaryEnvelope' } } } },
          },
        },
      },
      '/api/v1/users': {
        get: { summary: 'Admin: list users' },
        post: {
          summary: 'Admin: create member user',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserRequest' } } } },
        },
      },
      '/api/v1/users/{userId}': {
        patch: {
          summary: 'Admin: update member email/password/status',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PatchUserRequest' } } } },
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
        get: { summary: 'List schedules' },
        post: { summary: 'Create schedule' },
      },
      '/api/v1/schedules/{scheduleId}': {
        get: { summary: 'Get schedule detail' },
        patch: { summary: 'Update schedule' },
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
          },
          required: ['id', 'name', 'email', 'role', 'isActive', 'createdAt', 'updatedAt'],
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
      },
    },
  }

  return c.json(spec)
})

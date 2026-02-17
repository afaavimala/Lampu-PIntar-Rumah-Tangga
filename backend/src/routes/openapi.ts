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
      '/api/v1/bootstrap': { get: { summary: 'Bootstrap dashboard session' } },
      '/api/v1/commands/sign': { post: { summary: 'Create signed command envelope' } },
      '/api/v1/commands/execute': { post: { summary: 'Sign and publish command via backend proxy' } },
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
      '/api/v1/devices/{deviceId}': {
        get: { summary: 'Get device detail' },
      },
      '/api/v1/devices/{deviceId}/status': {
        get: { summary: 'Get fallback status for a device' },
      },
      '/api/v1/openapi.json': {
        get: { summary: 'OpenAPI document' },
      },
    },
  }

  return c.json(spec)
})

# Rencana Implementasi MVP End-to-End SmartLamp IoT (Hono + Vite + D1 + MQTT WSS + Scheduler)

## Ringkasan
Implementasi akan dilakukan dari nol sesuai `README.md` dan `Dokumentasi_Utama_SmartLamp_IoT.md`, dengan fokus:
1. Backend `Hono` di Cloudflare Workers.
2. Frontend `Vite + React + TypeScript`.
3. `D1` schema + seed awal (admin + sample device).
4. Realtime MQTT via `HiveMQ WSS` untuk dashboard.
5. Scheduler ON/OFF otomatis via `Cron Trigger` Worker.
6. Open Integration API v1 + OpenAPI JSON.
7. Verifikasi wajib via `Playwright MCP` untuk local dan cloud.
8. Firmware ESP32 tidak diimplementasikan pada pass ini (kontrak tetap dijaga).

## Scope Implementasi
1. In-scope:
- Auth login cookie-based.
- Device listing + fallback status API.
- Command signing API.
- Schedule CRUD + run history + scheduler execution.
- Publish command terjadwal dari Worker ke HiveMQ via WSS.
- Dashboard login, control, realtime status/lwt, manajemen jadwal.
- Kontrak API v1 + envelope standar + API key scope check.
- Playwright MCP smoke+critical scenarios.
2. Out-of-scope:
- Firmware production-ready ESP32.
- Endpoint admin penuh untuk user/device/API-key lifecycle.
- Monitoring observability enterprise-level.

## Struktur Repo Target
1. `backend/`
- `package.json`
- `wrangler.toml`
- `src/index.ts`
- `src/routes/*.ts`
- `src/middleware/*.ts`
- `src/lib/*.ts`
- `migrations/0001_init.sql`
- `migrations/0002_seed.sql`
2. `dashboard/`
- `package.json`
- `vite.config.ts`
- `src/main.tsx`
- `src/pages/*.tsx`
- `src/components/*.tsx`
- `src/lib/*.ts`
3. Root:
- `README.md` disinkronkan command run/deploy.
- `Dokumentasi_Utama_SmartLamp_IoT.md` tetap single source of truth.

## Perubahan API Publik (v1)
1. Auth:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
2. Core:
- `GET /api/v1/bootstrap`
- `POST /api/v1/commands/sign`
- `GET /api/v1/status`
3. Schedules:
- `POST /api/v1/schedules`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `PATCH /api/v1/schedules/{scheduleId}`
- `DELETE /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`
4. Open integration:
- `GET /api/v1/integrations/capabilities`
- `GET /api/v1/devices`
- `GET /api/v1/devices/{deviceId}`
- `GET /api/v1/devices/{deviceId}/status`
- `GET /api/v1/openapi.json`

## Kontrak Interface/Type Utama
1. `CommandSignRequest`:
- `deviceId`, `action`, `requestId`
2. `CommandEnvelope`:
- `deviceId`, `action`, `requestId`, `issuedAt`, `expiresAt`, `nonce`, `sig`
3. `ScheduleRule`:
- `id`, `deviceId`, `action`, `cron`, `timezone`, `enabled`, `nextRunAt`
4. `ScheduleRun`:
- `scheduleId`, `plannedAt`, `executedAt`, `status`, `requestId`, `reason`
5. Response envelope standar:
- `success`, `data`, `error`, `meta`
6. Error codes minimum:
- `AUTH_INVALID_TOKEN`, `AUTH_EXPIRED_TOKEN`, `FORBIDDEN_DEVICE_ACCESS`, `DEVICE_NOT_FOUND`, `VALIDATION_ERROR`, `SCHEDULE_NOT_FOUND`, `SCHEDULE_INVALID_CRON`, `SCHEDULE_INVALID_TIMEZONE`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`

## Data Model D1 Final
1. Tabel inti:
- `users`, `devices`, `user_devices`, `command_logs`
2. Integrasi:
- `integration_clients`, `idempotency_records`
3. Scheduler:
- `device_schedules`, `schedule_runs`
4. Index:
- `idx_device_schedules_due (enabled, next_run_at)`
- `idx_schedule_runs_schedule_id (schedule_id, planned_at)`
5. Seed:
- 1 admin user.
- 1 sample device.
- 1 mapping `user_devices`.

## Detail Implementasi Backend
1. Framework:
- Hono + TypeScript.
- Validasi input dengan Zod.
- OpenAPI generation dari schema route.
2. Auth:
- Login set `HttpOnly` cookie.
- `SameSite=Strict`, `Path=/`, `Secure=true` di prod, `Secure=false` di local.
- API key auth untuk integration endpoints.
3. Middleware:
- Request ID injection.
- Response envelope formatter.
- Idempotency checker untuk endpoint mutasi.
- Scope authorization checker.
4. Signing:
- HMAC per-device secret dari D1.
- Canonical signing string tetap untuk manual+schedule command.
- Expiry pendek (default 30 detik).
5. Fallback status:
- `GET /api/v1/status` dan `/devices/{id}/status` menggunakan state terbaik dari `command_logs` + latest `schedule_runs` (bukan jaminan actual device state realtime).

## Detail Implementasi Scheduler
1. Worker Cron Trigger:
- Interval `* * * * *` (per menit).
2. Runner flow:
- Query due schedules: `enabled=1 AND next_run_at<=now`, limit batch 50.
- Untuk setiap schedule, gunakan `planned_at` menit berjalan.
- Insert `schedule_runs(schedule_id, planned_at)` terlebih dulu.
- Jika conflict unique, tandai skip (dedup).
- Generate signed command envelope.
- Publish ke HiveMQ topic `home/{deviceId}/cmd`.
- Update `schedule_runs` status `SUCCESS/FAILED`.
- Recalculate `next_run_at` berdasarkan cron+timezone.
3. Timezone:
- IANA timezone wajib.
- Perhitungan next run konsisten DST.

## Strategi MQTT WSS (Cloudflare Worker -> HiveMQ)
1. Publish scheduler memakai koneksi WSS pendek per eksekusi/batch, bukan long-lived bridge.
2. Implement transport MQTT over WSS di Worker dengan:
- WebSocket native Worker (`wss://...`).
- MQTT packet encode/decode.
- Sequence minimal: `CONNECT -> CONNACK -> PUBLISH(QoS1) -> PUBACK -> DISCONNECT`.
3. Batas koneksi:
- Jalankan publish scheduler dengan concurrency kecil (maks 3 paralel) untuk aman terhadap limit koneksi outbound Worker.
4. Dashboard realtime:
- Gunakan MQTT over WSS dari browser ke HiveMQ untuk subscribe `status/lwt`.

## Detail Implementasi Frontend
1. Stack:
- Vite + React + TypeScript.
2. Halaman:
- Login.
- Dashboard device cards (power, online/offline, status terakhir).
- Schedule manager (list/create/edit/delete/toggle enable).
- Schedule run history panel.
3. Data flow:
- Auth via cookie.
- Fetch API untuk control plane.
- MQTT client browser untuk realtime status/lwt.
4. Realtime behavior:
- Auto reconnect.
- Resubscribe topic saat reconnect.
- Render retained status/lwt.

## Konfigurasi Environment
1. Backend Worker secrets:
- `JWT_SECRET`
- `HMAC_GLOBAL_FALLBACK_SECRET` (opsional)
- `MQTT_WS_URL`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `MQTT_CLIENT_ID_PREFIX`
- `COOKIE_SECURE`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_SAMPLE_DEVICE_ID`
2. Backend bindings:
- `D1` binding (mis. `DB`)
3. Frontend env:
- `VITE_API_BASE_URL`
- `VITE_MQTT_WS_URL`
- `VITE_MQTT_USERNAME`
- `VITE_MQTT_PASSWORD`
- `VITE_MQTT_CLIENT_ID_PREFIX`

## Rencana Verifikasi dan Testing
1. Backend checks:
- Unit tests untuk signing, cron next-run calculation, idempotency logic.
- Contract tests untuk envelope/error codes.
2. Playwright MCP (wajib):
- Local `http://127.0.0.1:5173`.
- Cloud production URL.
3. Skenario wajib:
- Login sukses/gagal.
- Command sign sukses + forbidden device.
- Dashboard control ON/OFF.
- Realtime status/lwt update.
- Device offline handling.
- Reconnect + resubscribe.
- Schedule create/edit/delete.
- Schedule pause/resume.
- Eksekusi cron otomatis.
- Timezone/DST consistency.
- Dedup no double-execution.
- OpenAPI endpoint reachable.
4. Evidence:
- Screenshot per skenario.
- Catatan pass/fail per skenario.

## Urutan Eksekusi Implementasi
1. Bootstrap monorepo folders `backend` dan `dashboard`.
2. Implement backend core config + D1 schema/migration/seed.
3. Implement auth + middleware + envelope + idempotency.
4. Implement command/sign + devices + status + open integration routes.
5. Implement scheduler CRUD + run history.
6. Implement Worker Cron runner + MQTT WSS publish path.
7. Implement dashboard login + device UI + MQTT realtime.
8. Implement schedule management UI.
9. Implement Playwright MCP test flow local.
10. Deploy cloud + configure secrets/cron + run Playwright MCP cloud verification.
11. Sinkronisasi akhir dokumentasi dan acceptance checklist.

## Asumsi dan Default yang Dikunci
1. Package manager: `npm`.
2. Frontend template: `React + TypeScript`.
3. Auth frontend: `HttpOnly cookie` (bukan localStorage).
4. Bootstrap data: seed migration otomatis.
5. Open integration depth: read + command + schedules + scope check.
6. Scheduler publish: direct Worker -> HiveMQ WSS.
7. MQTT command topic: `home/{deviceId}/cmd` QoS1 non-retained.
8. Firmware tidak dibangun di pass ini; kontrak payload/topic tetap final sesuai dokumen.

# Lampu Pintar Rumah Tangga

MVP SmartLamp IoT berbasis `ESP32 + HiveMQ + Cloudflare` dengan stack wajib:
- Backend: `Hono` di Cloudflare Workers.
- Frontend: `Vite + React + TypeScript`.
- Database: `Cloudflare D1`.
- Realtime: MQTT over WebSocket (`WSS`) untuk dashboard.
- Scheduler: Worker `Cron Trigger` per menit.

Single source of truth arsitektur dan TODO: `Dokumentasi_Utama_SmartLamp_IoT.md`.

## Arsitektur Ringkas

```text
ESP32 -- MQTT TLS --> HiveMQ Broker <-- MQTT WSS -- Dashboard (Vite/Pages)
                          ^
                          |
            Cloudflare Worker (Hono): auth, signing, schedules, API v1
                          |
                          v
                       D1 Database
```

## Struktur Repo

```text
backend/    # Hono Worker + D1 migrations + scheduler + API v1
 dashboard/ # Vite React dashboard + MQTT WSS client
Dokumentasi_Utama_SmartLamp_IoT.md
PLAYWRIGHT_VERIFICATION.md
```

## Fitur MVP yang Sudah Diimplementasi

- Auth login/refresh/logout berbasis cookie `HttpOnly`.
- Access token TTL pendek + refresh token rotation per request refresh.
- Bootstrap session (`devices + mqtt config`).
- Command signing (`POST /api/v1/commands/sign`) dengan HMAC envelope.
- Schedule CRUD + run history.
- Scheduler runner via Cron trigger + publish MQTT WSS dari Worker.
- Open integration API v1 + endpoint discovery + OpenAPI JSON.
- Dashboard login, device card, kontrol ON/OFF, manajemen jadwal, run history.
- Password verification hardening dengan `bcrypt` (+ auto-upgrade legacy hash).
- Rate limit untuk `POST /api/v1/auth/login` dan `POST /api/v1/commands/sign`.
- Verifikasi lokal via Playwright MCP (evidence di `PLAYWRIGHT_VERIFICATION.md`).

## Prasyarat

- Node.js 20+
- npm
- Cloudflare Wrangler CLI (sudah sebagai dev dependency backend)

## Root Commands

Semua command sekarang bisa dijalankan dari root project:

```bash
# install backend + dashboard
npm run install:all

# copy env local jika belum ada
npm run env:local

# migrate D1 local / remote
npm run migrate:local
npm run migrate:remote

# setup local lengkap (install + env + migrate)
npm run setup:local

# jalankan backend + dashboard bersamaan
npm run dev

# validasi/build semua
npm run build

# deploy worker/pages/all
npm run deploy:worker
npm run deploy:pages
npm run deploy
```

Catatan:
- `npm run deploy:pages` pakai project default `smartlamp-dashboard`.
- Untuk ganti project Pages: `CF_PAGES_PROJECT=nama-project npm run deploy:pages`.
- Untuk override env backend/frontend dari root, gunakan `.env` (template: `.env.example`) lalu jalankan `npm run env:local`.

## Setup Lokal

1. Install dependency:

```bash
npm run install:all
```

2. Siapkan env:

```bash
# opsional: siapkan override root
cp .env.example .env

# sinkron ke backend/.dev.vars + dashboard/.env.local
npm run env:local
```

3. Terapkan migrasi D1 lokal:

```bash
npm run migrate:local
```

4. Jalankan backend:

```bash
npm run dev:backend
```

5. Jalankan frontend:

```bash
npm run dev:dashboard
```

Atau langsung jalankan keduanya:

```bash
npm run dev
```

Seed default lokal:
- Email: `admin@example.com`
- Password: `admin12345`
- Demo API key plaintext: `demo-integration-key`

## Environment Variables

Backend (`backend/.dev.vars`):
- `JWT_SECRET`
- `HMAC_GLOBAL_FALLBACK_SECRET` (opsional fallback)
- `MQTT_WS_URL`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `MQTT_CLIENT_ID_PREFIX`
- `JWT_ACCESS_TTL_SEC`
- `JWT_REFRESH_TTL_SEC`
- `COOKIE_SECURE`
- `COOKIE_SAME_SITE`
- `COOKIE_DOMAIN`
- `CORS_ORIGINS` (comma-separated)
- `AUTH_LOGIN_RATE_LIMIT_MAX`
- `AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC`
- `COMMAND_SIGN_RATE_LIMIT_MAX`
- `COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_SAMPLE_DEVICE_ID`

Contoh file:
- Root override template: `.env.example`
- Local dev: `backend/.dev.vars.local.example`
- Worker production reference: `backend/.worker.production.env.example`

Frontend (`dashboard/.env.local`):
- `VITE_API_BASE_URL`
- `VITE_MQTT_WS_URL`
- `VITE_MQTT_USERNAME`
- `VITE_MQTT_PASSWORD`
- `VITE_MQTT_CLIENT_ID_PREFIX`

## API v1

Auth:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Core:
- `GET /api/v1/bootstrap`
- `POST /api/v1/commands/sign`
- `GET /api/v1/status`

Schedules:
- `POST /api/v1/schedules`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `PATCH /api/v1/schedules/{scheduleId}`
- `DELETE /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`

Open integration:
- `GET /api/v1/integrations/capabilities`
- `GET /api/v1/devices`
- `GET /api/v1/devices/{deviceId}`
- `GET /api/v1/devices/{deviceId}/status`
- `GET /api/v1/openapi.json`

## Testing

Backend:

```bash
cd backend
npm run typecheck
npm run test
```

Frontend:

```bash
cd dashboard
npm run build
```

E2E/UI verification: gunakan Playwright MCP. Ringkasan hasil lokal ada di `PLAYWRIGHT_VERIFICATION.md`.

## Deploy Cloudflare

Backend Worker:

```bash
npm run deploy:worker
```

Frontend Pages:

```bash
npm run deploy:pages
```

Deploy semua:

```bash
npm run deploy
```

Wajib setelah deploy:
- Bind D1 production di `wrangler.toml`.
- Set Worker vars/secrets production.
- Aktifkan `Cron Trigger` (`* * * * *`).
- Set `VITE_API_BASE_URL` ke URL Worker production.

Contoh set vars/secrets di Worker production:

```bash
cd backend

# Vars non-secret (boleh di wrangler.toml [vars] atau CLI --var)
# JWT_ACCESS_TTL_SEC=900
# JWT_REFRESH_TTL_SEC=2592000
# COOKIE_SECURE=true
# COOKIE_SAME_SITE=None
# COOKIE_DOMAIN=yourdomain.com
# CORS_ORIGINS=https://your-dashboard.pages.dev
# AUTH_LOGIN_RATE_LIMIT_MAX=5
# AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC=60
# COMMAND_SIGN_RATE_LIMIT_MAX=20
# COMMAND_SIGN_RATE_LIMIT_WINDOW_SEC=60

# Secrets
echo 'replace-me-jwt-secret' | npx wrangler secret put JWT_SECRET
echo 'replace-me-hmac-secret' | npx wrangler secret put HMAC_GLOBAL_FALLBACK_SECRET
echo 'wss://your-cluster.s1.eu.hivemq.cloud:8884/mqtt' | npx wrangler secret put MQTT_WS_URL
echo 'mqtt-username' | npx wrangler secret put MQTT_USERNAME
echo 'mqtt-password' | npx wrangler secret put MQTT_PASSWORD
echo 'admin12345' | npx wrangler secret put SEED_ADMIN_PASSWORD
```

Catatan cookie production:
- Jika frontend dan worker beda site (`pages.dev` vs `workers.dev`), gunakan `COOKIE_SECURE=true` dan `COOKIE_SAME_SITE=None`.
- Jika pakai custom domain same-site, `COOKIE_SAME_SITE=Strict` tetap bisa dipakai.

## Catatan Penting MQTT WSS

- Cloudflare Pages (browser) ke HiveMQ via `wss://` didukung.
- Cloudflare Worker scheduler ke HiveMQ via `wss://` juga didukung (koneksi pendek per eksekusi).
- Untuk lulus realtime end-to-end, wajib isi credential HiveMQ yang valid (bukan placeholder).

# Lampu Pintar Rumah Tangga

MVP SmartLamp IoT berbasis `ESP32 + HiveMQ + Hono + Vite` dengan dual deployment:
- Lokal: Node.js + MariaDB.
- Cloudflare: Worker + D1.

Stack saat ini:
- Backend: `Hono` (Node runtime untuk lokal, Worker runtime untuk Cloudflare).
- Frontend: `Vite + React + TypeScript`.
- Database: `MariaDB` (lokal) / `Cloudflare D1` (cloud).
- Realtime: MQTT proxy di backend, frontend consume SSE (`/api/v1/realtime/stream`).
- Scheduler: interval in-process (lokal) / Cron Trigger Worker (cloud).

Catatan runtime realtime:
- Node lokal: SSE disuplai dari subscriber MQTT backend (event status/lwt broker).
- Cloudflare Worker: SSE fallback polling status DB (tanpa kredensial MQTT di frontend).

## Arsitektur Ringkas

```text
ESP32 -- MQTT TLS --> HiveMQ Broker <-- MQTT WSS --> Node.js + Hono API
                                                     |      ^
                                                     |      |
                                    Dashboard (browser) -- SSE (/api/v1/realtime/stream)
                          |
                          v
                       MariaDB
```

Mode production lokal (single port):
- Frontend dibuild ke `dashboard/dist`.
- Backend Node melayani API + file frontend di port yang sama (`PORT`, default `8080`).

Mode cloudflare:
- Backend deploy ke Worker (`backend/src/index.ts`).
- Frontend deploy ke Pages.

## Struktur Repo

```text
backend/    # Hono API (Node + Worker), migrasi MariaDB & D1
dashboard/  # Vite React dashboard + realtime SSE client
scripts/    # script setup/build/deploy lokal + cloud
```

## Prasyarat

- Node.js 20+
- npm
- MariaDB server aktif

## Root Commands

```bash
# install backend + dashboard
npm run install:all

# siapkan env untuk development / production
npm run env:local
npm run env:production

# migrasi database MariaDB
npm run migrate:local
npm run migrate:production

# migrasi database D1 cloud
npm run migrate:remote

# setup cepat
npm run setup:local
npm run setup:production

# development mode (backend :8787 + dashboard :5173)
npm run dev

# validasi/build
npm run build

# production single port
npm run start:production

# flow deploy lokal (migrate + build + start)
npm run deploy:local
npm run deploy

# deploy cloudflare (worker + pages)
npm run deploy:worker
npm run deploy:pages
npm run deploy:cloud
```

## Setup Development Lokal

1. Install dependency:

```bash
npm run install:all
```

2. Siapkan root env (single source of truth):

```bash
cp .env.example .env
```

3. Edit `.env`:
- Gunakan parameter shared: `BACKEND_*` dan `FRONTEND_*`
- MariaDB credential wajib: `BACKEND_DB_HOST`, `BACKEND_DB_PORT`, `BACKEND_DB_USER`, `BACKEND_DB_PASSWORD`, `BACKEND_DB_NAME`
- Secret wajib: `BACKEND_JWT_SECRET`, `BACKEND_HMAC_GLOBAL_FALLBACK_SECRET`
- MQTT wajib: `BACKEND_MQTT_WS_URL`, `BACKEND_MQTT_USERNAME`, `BACKEND_MQTT_PASSWORD`

4. Generate file env lokal dari root `.env`:

```bash
npm run env:local
```

5. Migrasi database:

```bash
npm run migrate:local
```

6. Jalankan backend + dashboard:

```bash
npm run dev
```

Default dev URL:
- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8787`

## Deploy Production Lokal (Single Port)

1. Install dependency + siapkan root env:

```bash
npm run install:all
cp .env.example .env
```

2. Edit `.env` untuk production lokal:
- `BACKEND_PORT` (misal `8080`)
- `BACKEND_SERVE_DASHBOARD=true`
- `BACKEND_DB_*` untuk MariaDB production
- `BACKEND_SEED_ADMIN_PASSWORD` (ganti dari default)
- `FRONTEND_VITE_API_BASE_URL=` (kosong untuk mode 1 port)

3. Generate env production dari root `.env`:

```bash
npm run env:production
```

4. Migrasi database production:

```bash
npm run migrate:production
```

5. Build frontend + validasi:

```bash
npm run build
```

6. Jalankan production:

```bash
npm run start:production
```

Catatan shared-only:
- Nilai `BACKEND_*` dan `FRONTEND_*` dipakai untuk local dev, local production, dan cloud.
- Jika ingin nilai berbeda antar mode, edit `.env` lalu jalankan ulang `npm run env:local` atau `npm run env:production`.

App dapat diakses di:
- `http://127.0.0.1:8080` (atau sesuai `PORT`)

API health check:
- `GET /api/health`

## Deploy Cloudflare (Tetap Didukung)

1. Siapkan root env:

```bash
cp .env.example .env
npm run env:production
```

Key utama di `.env`:
- Worker/D1: `CF_D1_DATABASE_NAME`, `CF_WORKER_ENV`
- Worker vars/secrets: `BACKEND_*` (sinkron ke Worker saat deploy)
- Pages build vars: `FRONTEND_*`
- Pages deploy target: `CF_PAGES_PROJECT`, `CF_PAGES_BRANCH`

2. Pastikan `backend/wrangler.toml` sudah benar:
- binding D1 (`[[d1_databases]]`)
- cron trigger (`[triggers]`)

3. Jalankan migrasi D1 remote:

```bash
npm run migrate:remote
```

4. Deploy Worker:

```bash
npm run deploy:worker
```

Catatan:
- `CF_WORKER_SYNC_SECRETS=true` akan sinkron secret via `wrangler secret put`.
- `CF_WORKER_KEEP_VARS=true` mencegah var existing di dashboard terhapus.
- `CF_WORKER_DRY_RUN=true` untuk verifikasi command deploy tanpa publish.

5. Deploy Pages:

```bash
npm run deploy:pages
```

## Environment Files

- Root override tunggal (source of truth): `.env` (buat dari `.env.example`)
- Generated lokal:
  - `backend/.env.local`
  - `dashboard/.env.local`
  - `backend/.dev.vars.local`
- Generated production:
  - `backend/.env.production`
  - `dashboard/.env.production`
  - `backend/.worker.production.env`
- Template:
  - `backend/.env.local.example`
  - `backend/.env.production.example`
  - `backend/.dev.vars.local.example`
  - `backend/.worker.production.env.example`
  - `dashboard/.env.example`
  - `dashboard/.env.production.example`

## Seed Default

Migrasi MariaDB akan memastikan seed default:
- Admin email (default): `admin@example.com`
- Admin password (default): `admin12345` (ubah di env production)
- Sample device (default): `lampu-ruang-tamu`
- Demo API key (default): `demo-integration-key`

Semua nilai seed bisa diubah via env `SEED_*` di backend env file.

## API v1

Auth:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Core:
- `GET /api/v1/bootstrap`
- `POST /api/v1/commands/execute` (utama, dipakai dashboard)
- `POST /api/v1/commands/sign` (opsional kompatibilitas)
- `GET /api/v1/realtime/stream` (SSE)
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

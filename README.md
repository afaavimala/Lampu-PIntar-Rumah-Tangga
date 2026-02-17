# Lampu Pintar Rumah Tangga

MVP SmartLamp IoT berbasis `ESP32 + HiveMQ + Hono + Vite` dengan deployment fleksibel:
- Lokal: Node.js + MariaDB.
- Cloudflare: single Worker + D1 (API + frontend assets pada 1 URL).

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
- Backend Node melayani API + file frontend di port yang sama (`PORT` dari `BACKEND_PORT`, default `8787`).

Mode cloudflare:
- Backend + frontend deploy ke Worker yang sama (`backend/src/index.ts` + assets dari `dashboard/dist`).

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

# siapkan env untuk development / production (wajib sudah ada root .env)
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

# development mode (backend :BACKEND_PORT default 8787 + dashboard :5173)
npm run dev
npm run dev:backend
npm run dev:dashboard

# validasi/build
npm run typecheck
npm run test
npm run build

# production single port
npm run start:production

# flow deploy lokal (migrate + build + start)
npm run deploy:local

# deploy cloudflare (single worker)
npm run migrate:remote
npm run deploy:worker
```

## Setup Development Lokal

### Opsi cepat

```bash
cp .env.example .env
# edit .env sesuai environment lokal
npm run setup:local
npm run dev
```

### Opsi manual

1. Install dependency.
```bash
npm run install:all
```
2. Buat root env.
```bash
cp .env.example .env
```
3. Isi `.env` minimal:
- `BACKEND_DB_HOST`, `BACKEND_DB_PORT`, `BACKEND_DB_USER`, `BACKEND_DB_PASSWORD`, `BACKEND_DB_NAME`
- `BACKEND_JWT_SECRET`, `BACKEND_HMAC_GLOBAL_FALLBACK_SECRET`
- `BACKEND_MQTT_WS_URL`, `BACKEND_MQTT_USERNAME`, `BACKEND_MQTT_PASSWORD`
4. Generate env lokal turunan.
```bash
npm run env:local
```
5. Jalankan migrasi MariaDB lokal.
```bash
npm run migrate:local
```
6. Jalankan aplikasi.
```bash
npm run dev
```

URL default development:
- Dashboard: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8787`

Catatan:
- `npm run dev` otomatis sinkronkan `.env` -> `backend/.env.local` dan `dashboard/.env.local` sebelum start.
- Untuk run terpisah: `npm run dev:backend` dan `npm run dev:dashboard`.

## Deploy Production Lokal (Single Port)

### Opsi cepat (sekali jalan)

```bash
cp .env.example .env
# edit .env untuk mode production lokal
npm run deploy:local
```

`deploy:local` akan menjalankan: `env:production` -> `migrate:production` -> `build` -> `start:production`.

### Opsi manual

1. Siapkan dependency + root env.
```bash
npm run install:all
cp .env.example .env
```
2. Set nilai penting di `.env`:
- `BACKEND_SERVE_DASHBOARD=true`
- `BACKEND_PORT` (misal `8080`)
- seluruh `BACKEND_DB_*` untuk DB production
- `BACKEND_SEED_ADMIN_PASSWORD` wajib diganti
- `FRONTEND_VITE_API_BASE_URL=` tetap kosong untuk mode same-origin single port
3. Generate env production.
```bash
npm run env:production
```
4. Migrasi DB production.
```bash
npm run migrate:production
```
5. Build + jalankan.
```bash
npm run build
npm run start:production
```

Verifikasi:
- App: `http://127.0.0.1:<BACKEND_PORT>`
- Health: `GET /api/health`

## Deploy Cloudflare Worker (Single URL)

1. Pastikan sudah login Wrangler (`npx wrangler login`) dan binding D1/Assets/Cron di `backend/wrangler.toml` valid.
2. Siapkan root env.
```bash
cp .env.example .env
# edit .env untuk cloud
```
3. Pastikan nilai cloud penting:
- `CF_D1_DATABASE_NAME` (dan `CF_WORKER_ENV` jika pakai environment wrangler)
- `CF_WORKER_SYNC_SECRETS=true` jika ingin sinkron secret otomatis
- `FRONTEND_VITE_API_BASE_URL=` kosong untuk deployment single Worker same-origin
4. Generate env production turunan.
```bash
npm run env:production
```
5. Jalankan migrasi D1 remote.
```bash
npm run migrate:remote
```
6. Deploy Worker.
```bash
npm run deploy:worker
```

Catatan deploy cloud:
- Script deploy otomatis build frontend (`dashboard/dist`) lalu upload assets + API ke Worker yang sama.
- Script deploy otomatis sync vars/secrets dari root `.env` saat `CF_WORKER_SYNC_SECRETS=true`.
- Override sekali jalan jika perlu:
```bash
FRONTEND_VITE_API_BASE_URL= npm run deploy:worker
```
- Gunakan `CF_WORKER_DRY_RUN=true` untuk validasi perintah deploy tanpa publish.

## Environment Files

- Root override tunggal (source of truth): `.env` (buat dari `.env.example`)
- `npm run env:local` dan `npm run env:production` sekarang akan gagal jika root `.env` belum ada.
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

## MQTT Contract (ESP32 Integration)

Topic standar:
- Command: `home/{deviceId}/cmd`
- Status: `home/{deviceId}/status`
- LWT: `home/{deviceId}/lwt`

QoS/retain yang dipakai sistem:
- `cmd`: QoS 1, retain `false` (publish dari backend)
- `status`: QoS 1, retain `true` (publish dari device)
- `lwt`: QoS 1, retain `true` (LWT online/offline dari device)

Payload command (backend -> ESP32):

```json
{
  "deviceId": "lampu-ruang-tamu",
  "action": "ON",
  "requestId": "req-123",
  "issuedAt": 1739786400000,
  "expiresAt": 1739786430000,
  "nonce": "uuid-v4",
  "sig": "hex-hmac-sha256"
}
```

Signing canonical string (untuk verifikasi `sig` di ESP32):

```text
deviceId|action|requestId|issuedAt|expiresAt|nonce
```

Checklist integrasi ESP32:
- Subscribe `home/{deviceId}/cmd`, parse JSON envelope command.
- Verifikasi signature HMAC SHA-256 menggunakan secret device/global yang sama dengan backend.
- Tolak command jika `expiresAt` sudah lewat atau `nonce` pernah dipakai (anti replay).
- Sinkronkan waktu device (NTP) agar validasi `issuedAt`/`expiresAt` akurat.
- Publish status ke `home/{deviceId}/status` dan set LWT ke `home/{deviceId}/lwt`.

Source of truth implementasi:
- `backend/src/routes/commands.ts`
- `backend/src/lib/scheduler-runner.ts`
- `backend/src/lib/mqtt-ws.ts`
- `backend/src/lib/crypto.ts`
- `backend/src/lib/realtime-mqtt-proxy.ts`

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

## Catatan Operasional

- Endpoint `POST /api/v1/commands/execute` bergantung pada kredensial MQTT backend yang valid.
- Jika broker menolak autentikasi (mis. `MQTT CONNACK code 5`), API akan merespons `502`.

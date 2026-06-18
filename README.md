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
- Cloudflare Worker: command publish lewat Durable Object MQTT gateway (koneksi persisten broker), SSE tetap disuplai dari MQTT subscribe per stream + snapshot LWT retained.

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
firmware/   # referensi firmware ESP32 SmartLamp / Tasmota (MQTT + LWT)
docs/       # diagram arsitektur, dokumentasi utama, hasil verifikasi
```

## Dokumentasi

- `docs/Dokumentasi_Utama_SmartLamp_IoT.md`
- `docs/Diagram_Arsitektur_Ekosistem_SmartLamp.md`
- `docs/PLAYWRIGHT_VERIFICATION.md`
- `docs/diagram/README.md`

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
# (otomatis sync root .env -> backend/.env.production)
npm run start:production

# flow deploy lokal (migrate + build + start)
npm run deploy:local

# deploy cloudflare (single worker; deploy otomatis migrate remote kecuali dimatikan)
npm run deploy:worker

# verifikasi tambahan (opsional)
VERIFY_BASE_URL=http://127.0.0.1:8787 ./scripts/verify-parallel-devices.sh
VERIFY_BASE_URL=http://127.0.0.1:8787 ./scripts/measure-status-ack-latency.sh
```

Catatan migrasi SQL:
- File `0001_schema.sql` adalah baseline untuk DB baru.
- File setelah `0001` berisi upgrade/backfill untuk DB yang sudah ada.
- D1: `backend/migrations/*.sql`
- MariaDB: `backend/migrations-mariadb/*.sql`

## Setup Development Lokal

### Opsi cepat

```bash
cp .env.example .env
# edit .env sesuai environment lokal
npm run setup:local

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
- `BACKEND_JWT_SECRET`
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
- `BACKEND_HOST=0.0.0.0` agar bisa diakses dari device lain dalam jaringan
- `BACKEND_PORT` (misal `8080`)
- seluruh `BACKEND_DB_*` untuk DB production
- `BACKEND_SEED_ADMIN_PASSWORD` wajib diganti
- `BACKEND_CORS_ORIGINS=*` jika frontend/API diakses dari origin beragam
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
- App lokal mesin server: `http://127.0.0.1:<BACKEND_PORT>`
- App dari device lain: `http://<IP-LAN-SERVER>:<BACKEND_PORT>`
- Health (kanonik): `GET /api/health`
- Health (alias kompatibilitas probe): `GET /health`

Catatan:
- `npm run start:production` akan selalu menjalankan `env:production` dulu agar konfigurasi turunan tetap sinkron dengan root `.env`.

## Deploy Cloudflare Worker (Single URL)

Bagian ini dibuat untuk alur paling aman: semua nilai cloud dibaca dari root `.env`, lalu script project membuat config Wrangler sementara. Dengan cara ini, deploy tidak salah memakai `database_id` lama yang masih tertulis di `backend/wrangler.toml`.

1. Login Wrangler.
```bash
npx wrangler login
```

2. Pastikan `backend/wrangler.toml` tersedia.
- `backend/wrangler.toml.example` hanya template awal.
- Jika belum ada, buat dari template:
```bash
cp backend/wrangler.toml.example backend/wrangler.toml
```

3. Siapkan root env.
```bash
cp .env.example .env
# edit .env untuk cloud
```

4. Isi nilai cloud penting di `.env`.
- `CF_WORKER_NAME`: nama Worker production.
- `CF_D1_DATABASE_NAME`: nama D1, misalnya `smartlamp_db`.
- `CF_D1_DATABASE_ID`: ID D1 dari Cloudflare Dashboard untuk database yang benar.
- `CF_D1_DATABASE_BINDING=DB`.
- `CF_WORKER_SYNC_SECRETS=true` agar secret ikut disinkronkan saat deploy.
- `CF_WORKER_AUTO_MIGRATE=true` agar `npm run deploy:worker` otomatis menjalankan `npm run migrate:remote`.
- `FRONTEND_VITE_API_BASE_URL=` kosong untuk deployment single Worker same-origin.
- `CF_WORKER_CRONS` format CSV, contoh: `* * * * *,0 7 * * *`.

5. Generate env production turunan.
```bash
npm run env:production
```

6. Uji migrasi remote. Aman dijalankan ulang.
```bash
npm run migrate:remote
```

7. Dry-run deploy. Mode ini build dan validasi deploy, tetapi tidak memigrasi DB dan tidak publish Worker.
```bash
CF_WORKER_DRY_RUN=true npm run deploy:worker
```

8. Deploy production. Secara default ini menjalankan migrate remote dulu, lalu deploy Worker.
```bash
npm run deploy:worker
```

Catatan deploy cloud:
- Script deploy otomatis build frontend (`dashboard/dist`) lalu upload assets + API ke Worker yang sama.
- Script deploy otomatis sync vars/secrets dari root `.env` saat `CF_WORKER_SYNC_SECRETS=true` memakai `wrangler deploy --secrets-file`, sehingga code + secret masuk dalam satu deployment.
- Script deploy otomatis menjalankan `npm run migrate:remote` sebelum publish jika `CF_WORKER_AUTO_MIGRATE=true`.
- Untuk mematikan auto-migrate sekali jalan:
```bash
CF_WORKER_AUTO_MIGRATE=false npm run deploy:worker
```
- Override sekali jalan jika perlu:
```bash
FRONTEND_VITE_API_BASE_URL= npm run deploy:worker
```
- Gunakan `CF_WORKER_DRY_RUN=true` untuk validasi perintah deploy tanpa publish.

### Troubleshooting Cloudflare D1

- Error `database ... could not be found`: biasanya command memakai `database_id` yang salah. Jangan jalankan `npx wrangler ... -c backend/wrangler.toml` langsung jika root `.env` punya override `CF_D1_DATABASE_ID`. Pakai `npm run migrate:remote` atau `npm run deploy:worker`.
- Error `duplicate column name`: migration lama pernah mencoba menambah kolom yang sudah ada. Script `npm run migrate:remote` sekarang menjalankan preflight schema dan migration RBAC sudah dibuat backfill-only.
- Jika ingin melihat DB target yang dipakai script, cek `.env`: `CF_D1_DATABASE_NAME`, `CF_D1_DATABASE_ID`, dan `CF_WORKER_ENV`.

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
- Admin password awal: isi `BACKEND_SEED_ADMIN_PASSWORD` / `SEED_ADMIN_PASSWORD` dengan secret kuat di env nyata.
- Sample device (default): `lampu-ruang-tamu`
- Demo API key (default): `demo-integration-key`

Semua nilai seed bisa diubah via env `SEED_*` di backend env file. Akun `SEED_ADMIN_EMAIL` selalu dipromosikan dan diaktifkan sebagai `admin`. Hash seed legacy bawaan akan di-upgrade ke password env, tetapi password yang sudah diedit dari Profile tidak ditimpa lagi saat login.

## Login dan Rate Limit

Login memakai pembatas percobaan gagal berbasis IP agar password tidak bisa ditebak terus-menerus:
- `BACKEND_AUTH_LOGIN_RATE_LIMIT_MAX`: jumlah gagal yang masih diberi respons normal.
- `BACKEND_AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC`: jendela hitung percobaan gagal.
- `BACKEND_AUTH_LOGIN_BACKOFF_BASE_SEC`: tunggu awal setelah melewati batas.
- `BACKEND_AUTH_LOGIN_BACKOFF_FACTOR`: pengali exponential backoff.
- `BACKEND_AUTH_LOGIN_BACKOFF_MAX_SEC`: batas tunggu maksimum.

Contoh: jika max `5`, base `30`, factor `2`, maka percobaan setelah melewati batas akan mendapat waktu tunggu yang bisa naik dari 30 detik, 60 detik, 120 detik, dan seterusnya sampai nilai maksimum. Dashboard menampilkan countdown realtime sampai 0 dan tidak menampilkan `requestId` teknis ke user.

## RBAC

Role user:
- `admin`: akun dari `SEED_ADMIN_EMAIL`; dapat membuka Dashboard, User Manager, Device Manager, Schedule Manager, dan Profile.
- `member`: dibuat dari User Manager; hanya membuka Dashboard dan Profile.
- Semua akun punya `name`, `email`, password, status aktif/nonaktif, dan role.
- User Manager memakai archive/restore, bukan hard delete. User archived tetap ada di database untuk menjaga riwayat log, schedule, dan assignment, tetapi tidak bisa login sampai direstore.

Permission member per device:
- `monitoring`: read-only untuk status/realtime dan metadata yang diizinkan.
- `control`: semua akses monitoring plus command ON/OFF.
- `manage`: control plus edit metadata device yang sudah di-assign.

Permission jadwal per device:
- `none`: tidak melihat jadwal device tersebut.
- `monitoring`: melihat jadwal dan run history.
- `manage`: membuat, mengubah, pause/resume, dan menghapus jadwal.

Aturan penting:
- Akses schedule bersifat per device. Jika member punya izin schedule pada sebuah device, daftar schedule device itu akan muncul walaupun schedule awalnya dibuat oleh admin atau user lain.
- `schedule_permission='none'` membuat seluruh bagian schedule untuk device tersebut tidak tampil di dashboard member.
- `schedule_permission='manage'` hanya valid jika `device_permission` minimal `control`. User Manager mencegah kombinasi invalid ini, dan backend tetap menolak mutasi jadwal bila device masih `monitoring`.
- Pada dashboard, form jadwal default memakai `Interval Eksekusi (menit) = 1`. Waktu diisi sebagai `HH:mm:ss`, tetapi scheduler tetap berjalan pada resolusi menit.

## API v1

Auth:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Core:
- `GET /api/v1/bootstrap`
- `POST /api/v1/commands/execute` (utama, dipakai dashboard)
- `GET /api/v1/realtime/stream` (SSE)
- `GET /api/v1/status`

Schedules:
- `POST /api/v1/schedules`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `PATCH /api/v1/schedules/{scheduleId}`
- `DELETE /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`
- Catatan dashboard: input jadwal memakai format waktu `HH:mm:ss`; backend tetap mengeksekusi pada resolusi menit.
- Admin dapat mengirim `targetUserId` saat membuat jadwal untuk member yang sudah punya schedule `manage` dan device `control/manage`.

Users/Profile:
- `GET /api/v1/profile`
- `PATCH /api/v1/profile`
- `GET /api/v1/users` (admin)
- `GET /api/v1/users?includeArchived=1` (admin, tampilkan user archived)
- `POST /api/v1/users` (admin, membuat `member`)
- `PATCH /api/v1/users/{userId}` (admin)
- `DELETE /api/v1/users/{userId}` (admin, archive/soft delete member)
- `POST /api/v1/users/{userId}/restore` (admin, restore member archived)
- `GET /api/v1/users/{userId}/assignments` (admin)
- `PUT /api/v1/users/{userId}/assignments` (admin)

Open integration:
- `GET /api/v1/integrations/capabilities`
- `POST /api/v1/devices` (tambah device dan assign ke user login)
- `GET /api/v1/devices`
- `GET /api/v1/devices/discovery` (scan auto-discovery device Tasmota via MQTT)
- `GET /api/v1/devices/{deviceId}`
- `GET /api/v1/devices/{deviceId}/status`
- `GET /api/v1/openapi.json`

## MQTT Contract (Tasmota Only)

Topic standar Tasmota:
- Command: `cmnd/{deviceId}/POWER` (kanonik)
- Status: `stat/{deviceId}/POWER`, `stat/{deviceId}/RESULT`, `tele/{deviceId}/STATE`
- LWT: `tele/{deviceId}/LWT` atau `{deviceId}/tele/LWT`

Payload command (backend -> device):
- `ON` atau `OFF` (plain text).

Catatan:
- Backend tidak lagi memakai profile native `home/{deviceId}/*`.
- Parser realtime backend hanya menerima event Tasmota (`stat/*`, `tele/*`).

Source of truth implementasi:
- `backend/src/routes/commands.ts`
- `backend/src/lib/scheduler-runner.ts`
- `backend/src/lib/mqtt-command-dispatch.ts`
- `backend/src/durable/mqtt-gateway-object.ts`
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

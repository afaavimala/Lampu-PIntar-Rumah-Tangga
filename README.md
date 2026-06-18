# Lampu Pintar Rumah Tangga

SmartHome IoT untuk mengelola lampu berbasis MQTT/Tasmota melalui dashboard web. Aplikasi ini bisa jalan lokal dengan MariaDB, atau deploy sebagai satu Cloudflare Worker yang berisi API, dashboard, scheduler, dan binding Cloudflare D1.

## Ringkasan

- Dashboard React untuk kontrol lampu, status realtime, jadwal, User Manager, dan Account/Profile.
- Backend Hono yang bisa berjalan di Node.js lokal dan Cloudflare Workers.
- Database lokal memakai MariaDB; deployment cloud memakai Cloudflare D1.
- MQTT memakai format Tasmota: command `cmnd/{deviceId}/POWER`, status `stat/*` dan `tele/*`.
- Scheduler lokal bisa berjalan tiap detik; scheduler cloud dipantik Cloudflare Cron Trigger lalu dilanjutkan Durable Object alarm tiap detik.
- RBAC: admin dari seed env, member dibuat admin dan diberi permission per device/jadwal.

## Arsitektur

```text
Browser Dashboard
  | HTTP/SSE
  v
Hono API + Scheduler
  |                 \
  | SQL              \ MQTT WSS
  v                   v
MariaDB / D1       HiveMQ / Broker MQTT
                      ^
                      |
                  Tasmota / ESP32
```

Mode lokal development:
- Backend: `http://127.0.0.1:8787`
- Dashboard Vite: `http://127.0.0.1:5173`
- Database: MariaDB

Mode Cloudflare:
- Satu URL Worker untuk dashboard + API.
- Assets dashboard diupload dari `dashboard/dist`.
- D1 binding bernama `DB`.
- Durable Object `MQTT_GATEWAY` dipakai untuk publish MQTT persisten.
- Cron trigger default membangunkan scheduler cloud tiap menit, lalu Durable Object alarm melanjutkan tick tiap detik selama Worker aktif.

## Struktur Repo

```text
backend/      Hono API, Worker entrypoint, migrasi D1/MariaDB, test backend
dashboard/    Vite + React dashboard
scripts/      script setup, migrasi, build, deploy lokal/cloud
firmware/     catatan firmware/perangkat
docs/         dokumentasi tambahan dan diagram
```

## Requirements

Wajib untuk semua mode:
- Node.js 20 atau lebih baru.
- npm 10 atau lebih baru.
- Git.

Untuk development lokal:
- MariaDB aktif dan bisa diakses dari mesin ini.
- Database MariaDB kosong atau siap dimigrasi.

Untuk Cloudflare Worker:
- Akun Cloudflare dengan akses Workers dan D1.
- Wrangler login: `npx wrangler login`.
- Token Wrangler harus punya akses `workers` dan `d1`.
- Broker MQTT yang mendukung WebSocket TLS, misalnya HiveMQ Cloud.

Versi yang sudah diverifikasi di workspace ini:
- Node.js `v24.13.1`
- npm `11.13.0`
- Wrangler `4.101.0`

## Install Awal

```bash
npm run install:all
cp .env.example .env
```

Edit `.env` sebelum menjalankan aplikasi. Jangan commit `.env` karena berisi secret.

Minimal yang perlu diisi:

```dotenv
BACKEND_JWT_SECRET=secret-panjang-dan-acak
BACKEND_MQTT_WS_URL=wss://broker.example:8884/mqtt
BACKEND_MQTT_USERNAME=username-mqtt
BACKEND_MQTT_PASSWORD=password-mqtt
BACKEND_SEED_ADMIN_EMAIL=admin@example.com
BACKEND_SEED_ADMIN_PASSWORD=password-admin-awal
```

Untuk lokal MariaDB, isi juga:

```dotenv
BACKEND_DB_HOST=127.0.0.1
BACKEND_DB_PORT=3306
BACKEND_DB_USER=root
BACKEND_DB_PASSWORD=
BACKEND_DB_NAME=smartlamp_local
```

## Root Commands

```bash
npm run install:all        # install dependency root, backend, dashboard
npm run env:local          # generate backend/dashboard env lokal dari root .env
npm run env:production     # generate env production lokal/worker dari root .env
npm run migrate:local      # migrasi MariaDB lokal
npm run migrate:production # migrasi MariaDB production lokal
npm run migrate:remote     # migrasi Cloudflare D1 remote
npm run setup:local        # env lokal + migrasi lokal
npm run setup:production   # env production + migrasi production MariaDB
npm run dev                # backend + dashboard development
npm run build              # typecheck backend + test backend + build dashboard
npm run deploy:local       # production lokal single-port
npm run deploy:worker      # build + auto-migrate D1 + deploy Cloudflare Worker
```

## Development Lokal

Alur cepat:

```bash
cp .env.example .env
# edit .env
npm run setup:local
npm run dev
```

URL:
- Dashboard: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

Alur manual:

```bash
npm run env:local
npm run migrate:local
npm run dev:backend
npm run dev:dashboard
```

## Production Lokal Single Port

Gunakan mode ini jika ingin menjalankan API dan dashboard dari satu server Node.js tanpa Cloudflare.

Set `.env`:

```dotenv
BACKEND_SERVE_DASHBOARD=true
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8787
FRONTEND_VITE_API_BASE_URL=
```

Jalankan:

```bash
npm run deploy:local
```

`deploy:local` melakukan:
1. `npm run env:production`
2. `npm run migrate:production`
3. `npm run build`
4. `npm run start:production`

Verifikasi:
- `http://127.0.0.1:8787`
- `http://127.0.0.1:8787/api/health`
- dari perangkat lain: `http://<IP-LAN-SERVER>:8787`

## Deploy Cloudflare Worker

Deployment Cloudflare membaca root `.env` sebagai source of truth. Script akan membuat config Wrangler sementara dari `backend/wrangler.toml`, lalu override nilai Worker/D1 dari `.env`. Ini sengaja dibuat agar tidak salah memakai `database_id` lama yang mungkin masih ada di file template.

### 1. Login dan cek akun

```bash
npx wrangler login
npx wrangler whoami
```

### 2. Siapkan D1

Jika sudah punya D1:

```bash
npx wrangler d1 list
```

Lalu isi `.env`:

```dotenv
CF_D1_DATABASE_NAME=nama_database
CF_D1_DATABASE_ID=uuid-database
CF_D1_DATABASE_BINDING=DB
```

Jika ingin mulai dari database fresh, buat D1 baru:

```bash
npx wrangler d1 create smartlamp_db_fresh
```

Salin `database_name` dan `database_id` hasil command itu ke `.env`. Jangan menghapus database lama sebelum database baru terverifikasi jalan.

### 3. Isi opsi Worker

Contoh `.env` cloud:

```dotenv
CF_WORKER_NAME=lampu-pintar
CF_WORKER_ENV=
CF_D1_DATABASE_NAME=smartlamp_db_fresh
CF_D1_DATABASE_ID=uuid-d1-baru
CF_D1_DATABASE_BINDING=DB
CF_WORKER_KEEP_VARS=true
CF_WORKER_SYNC_SECRETS=true
CF_WORKER_AUTO_MIGRATE=true
CF_WORKER_DRY_RUN=false
CF_WORKER_CRONS=* * * * *
FRONTEND_VITE_API_BASE_URL=
```

Catatan:
- `FRONTEND_VITE_API_BASE_URL=` dikosongkan untuk same-origin Worker.
- `CF_WORKER_AUTO_MIGRATE=true` membuat `npm run deploy:worker` otomatis menjalankan `npm run migrate:remote`.
- `CF_WORKER_DRY_RUN=true` tidak memigrasi DB dan tidak publish Worker.
- `CF_WORKER_KEEP_VARS=true` menjaga var yang sudah ada di dashboard Cloudflare.
- Secret seperti `JWT_SECRET`, `MQTT_WS_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, dan `SEED_ADMIN_PASSWORD` dikirim sebagai Worker secret saat `CF_WORKER_SYNC_SECRETS=true`.

### 4. Generate env production

```bash
npm run env:production
```

### 5. Migrasi D1 remote

```bash
npm run migrate:remote
```

Script ini aman dijalankan ulang. Untuk database fresh, `0001_schema.sql` membuat baseline schema, lalu migration berikutnya melakukan backfill/compatibility.

### 6. Dry run

```bash
CF_WORKER_DRY_RUN=true npm run deploy:worker
```

Dry run melakukan typecheck/build dan validasi deploy, tetapi skip migrasi D1 dan tidak publish Worker.

### 7. Deploy production

```bash
npm run deploy:worker
```

`deploy:worker` melakukan:
1. Load root `.env`.
2. Backend typecheck.
3. Build dashboard.
4. `npm run migrate:remote` jika `CF_WORKER_AUTO_MIGRATE=true`.
5. Sync Worker vars/secrets.
6. `wrangler deploy`.

## Membuat Database Cloud Fresh dengan Aman

Gunakan checklist ini saat ingin deploy ulang dari nol tanpa menyentuh DB lama:

1. Catat DB lama:
```bash
npx wrangler d1 list
```

2. Buat DB baru dengan nama unik:
```bash
npx wrangler d1 create smartlamp_db_fresh_YYYYMMDD
```

3. Update `.env`:
```dotenv
CF_D1_DATABASE_NAME=smartlamp_db_fresh_YYYYMMDD
CF_D1_DATABASE_ID=uuid-d1-baru
```

4. Migrasi DB baru:
```bash
npm run migrate:remote
```

5. Pastikan tabel ada:
```bash
npx wrangler d1 execute "$CF_D1_DATABASE_NAME" --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

6. Deploy Worker:
```bash
npm run deploy:worker
```

7. Verifikasi URL Worker:
- login admin seed berhasil.
- menu admin muncul: Dashboard, User Manager, Account.
- sample device seed muncul.
- schedule dapat dibuat.
- console browser tidak ada error.

8. Setelah yakin, database lama boleh disimpan sebagai backup. Penghapusan DB lama tidak dilakukan otomatis oleh project.

## Environment Files

Root `.env` adalah sumber utama. Script akan membuat file turunan sesuai mode.

File root:
- `.env.example`: template aman dicommit.
- `.env`: nilai nyata, jangan dicommit.

Generated lokal:
- `backend/.env.local`
- `dashboard/.env.local`
- `backend/.dev.vars.local`

Generated production:
- `backend/.env.production`
- `dashboard/.env.production`
- `backend/.worker.production.env`

Template turunan:
- `backend/.env.local.example`
- `backend/.env.production.example`
- `backend/.dev.vars.local.example`
- `backend/.worker.production.env.example`
- `dashboard/.env.example`
- `dashboard/.env.production.example`

## Seed Admin dan Login Awal

Seed admin berasal dari:

```dotenv
BACKEND_SEED_ADMIN_EMAIL=admin@example.com
BACKEND_SEED_ADMIN_PASSWORD=password-admin-awal
```

Aturan:
- Akun dengan email `BACKEND_SEED_ADMIN_EMAIL` dipastikan aktif sebagai `admin`.
- Password seed dipakai saat admin belum ada atau masih memakai hash seed lama.
- Jika password sudah diubah dari Account/Profile, login tidak terus-menerus menimpa password tersebut.
- Admin dapat membuat member, mengatur permission, archive/restore member, dan reset password member.

## RBAC dan Permission

Role:
- `admin`: akses Dashboard, User Manager, Device Manager, Schedule Manager, Account.
- `member`: akses Dashboard dan Account.

Permission device per member:
- `monitoring`: hanya lihat status/realtime.
- `control`: monitoring plus command ON/OFF.
- `manage`: full akses pada device yang di-assign, termasuk metadata.

Permission jadwal per device:
- `none`: section/list jadwal untuk device itu tidak tampil di dashboard member.
- `monitoring`: melihat daftar jadwal dan riwayat run, read-only.
- `manage`: membuat/edit/pause/delete jadwal, tetapi hanya valid jika device permission minimal `control`.

Catatan:
- Admin bypass permission operasional.
- Assignment jadwal bersifat per device, bukan per pembuat jadwal.
- User archived tidak bisa login, tetapi data historis tetap aman.

## Jadwal Lampu

Dashboard membuat jadwal berbasis window:
- `Waktu Dari`: awal window, format `HH:mm`.
- `Waktu Sampai`: akhir window, format `HH:mm`.
- `Kondisi Saat Rentang Aktif`: `ON` atau `OFF`.
- `Interval Eksekusi (mm:ss)`: default `01:00`, bisa sampai resolusi detik seperti `00:05`.
- Timezone dipilih dari dropdown.

Format window sengaja hanya `HH:mm` agar jadwal tetap mudah dibaca sebagai rentang waktu. Resolusi detik diatur lewat interval `mm:ss`.

Boundary jadwal memakai model `[start, end)`:
- Start ikut aktif.
- End tidak ikut aktif.

Contoh:
- `ON 18:00 - 23:00` aktif mulai `18:00:00` sampai sebelum `23:00:00`.
- `OFF 23:00 - 23:30` aktif mulai `23:00:00` sampai sebelum `23:30:00`.
- Tepat pada `23:00:00`, yang aktif hanya jadwal `OFF`.
- Jika interval `00:05`, command dievaluasi pada detik ke-0, ke-5, ke-10, dan seterusnya selama masih di dalam window.

Ini mencegah dua jadwal bersebelahan mengirim command berlawanan pada detik batas yang sama.

Catatan kompatibilitas API:
- Field lama `windowStartMinute`, `windowEndMinute`, dan `enforceEveryMinute` tetap dipakai agar dashboard/API lama tidak patah.
- Nilai field tersebut sekarang berbasis detik: `windowStartMinute/windowEndMinute` adalah detik sejak `00:00:00`, sedangkan `enforceEveryMinute` adalah interval detik.

## Login Rate Limit

Login gagal dibatasi per IP dan memakai exponential backoff.

Env:

```dotenv
BACKEND_AUTH_LOGIN_RATE_LIMIT_MAX=8
BACKEND_AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC=60
BACKEND_AUTH_LOGIN_BACKOFF_BASE_SEC=30
BACKEND_AUTH_LOGIN_BACKOFF_FACTOR=2
BACKEND_AUTH_LOGIN_BACKOFF_MAX_SEC=900
```

Dashboard menampilkan pesan ramah user dan countdown realtime sampai tombol login aktif lagi. `requestId` teknis tidak ditampilkan ke user.

## MQTT Contract

Command:

```text
cmnd/{deviceId}/POWER = ON
cmnd/{deviceId}/POWER = OFF
```

Status yang diterima:

```text
stat/{deviceId}/POWER
stat/{deviceId}/RESULT
tele/{deviceId}/STATE
tele/{deviceId}/LWT
{deviceId}/tele/LWT
```

Untuk multi-channel Tasmota, backend bisa memakai `POWER1`, `POWER2`, dan seterusnya melalui `command_channel`.

## API Ringkas

Auth:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

Core:
- `GET /api/health`
- `GET /api/v1/bootstrap`
- `GET /api/v1/status`
- `POST /api/v1/commands/execute`
- `GET /api/v1/realtime/stream`

Schedules:
- `GET /api/v1/schedules`
- `POST /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `PATCH /api/v1/schedules/{scheduleId}`
- `DELETE /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`

Users/Profile:
- `GET /api/v1/profile`
- `PATCH /api/v1/profile`
- `GET /api/v1/users`
- `POST /api/v1/users`
- `PATCH /api/v1/users/{userId}`
- `DELETE /api/v1/users/{userId}`
- `POST /api/v1/users/{userId}/restore`
- `GET /api/v1/users/{userId}/assignments`
- `PUT /api/v1/users/{userId}/assignments`

Devices/Integrations:
- `GET /api/v1/devices`
- `POST /api/v1/devices`
- `GET /api/v1/devices/discovery`
- `GET /api/v1/devices/{deviceId}`
- `GET /api/v1/devices/{deviceId}/status`
- `GET /api/v1/integrations/capabilities`
- `GET /api/v1/openapi.json`

## Testing dan Verifikasi

Backend:

```bash
npm --prefix backend run typecheck
npm --prefix backend run test
```

Dashboard:

```bash
npm --prefix dashboard run build
```

Semua:

```bash
npm run build
git diff --check
```

Smoke test cloud setelah deploy:

```bash
curl -fsS https://<worker-url>/api/health
curl -fsS https://<worker-url>/api/v1/openapi.json
```

UI QA minimal:
- Login admin seed.
- Pastikan menu `Dashboard`, `User Manager`, dan `Account` muncul.
- Buat member dengan nama/email/password.
- Assign device permission dan schedule permission.
- Login member dan pastikan menu admin tidak muncul.
- Cek schedule permission:
  - `none`: jadwal tidak tampil.
  - `monitoring`: jadwal tampil read-only.
  - `manage` + device `control/manage`: jadwal bisa dibuat/diedit.
- Pastikan browser console tidak ada error.

## Troubleshooting

### `database ... could not be found`

Penyebab paling sering: command Wrangler memakai `database_id` lama dari `backend/wrangler.toml`, sedangkan project memakai override `.env`.

Solusi:
- Pakai `npm run migrate:remote` dan `npm run deploy:worker`.
- Jangan menjalankan `npx wrangler ... -c backend/wrangler.toml` langsung jika `.env` punya `CF_D1_DATABASE_ID`.
- Cek target:
```bash
npx wrangler d1 list
```

### `duplicate column name`

Biasanya terjadi pada DB yang pernah dimigrasi sebagian. `npm run migrate:remote` punya preflight untuk menambah kolom yang hilang dan migration RBAC dibuat backfill-only. Jalankan migrasi lewat script project, bukan command mentah.

### Login admin gagal setelah fresh deploy

Cek:
- `BACKEND_SEED_ADMIN_EMAIL`
- `BACKEND_SEED_ADMIN_PASSWORD`
- Worker secret sudah tersinkron saat deploy.

Deploy ulang:

```bash
npm run deploy:worker
```

### Dashboard blank atau API beda origin

Untuk Cloudflare single Worker, pastikan:

```dotenv
FRONTEND_VITE_API_BASE_URL=
```

Jika diisi URL lain, dashboard akan call API ke origin tersebut.

### MQTT command gagal `502`

Biasanya broker menolak koneksi atau credential salah.

Cek:
- `BACKEND_MQTT_WS_URL`
- `BACKEND_MQTT_USERNAME`
- `BACKEND_MQTT_PASSWORD`
- device Tasmota online dan memakai topic yang sama dengan `deviceId` / `mqtt_device_id`.

### Cron tidak langsung terasa setelah deploy

Cloudflare Cron Trigger bisa butuh waktu propagasi setelah deploy. Scheduler detik memakai Durable Object alarm setelah cron pertama membangunkan Worker; jika Worker sedang idle, tunggu sampai cron berikutnya atau jalankan command manual dari dashboard untuk test cepat.

## Referensi

- Cloudflare Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/
- Cloudflare Wrangler D1 commands: https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/

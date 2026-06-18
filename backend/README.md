# SmartLamp Backend (Node + Hono + MariaDB)

## Menjalankan Lokal (Development)

```bash
cd ..
cp .env.example .env
npm run env:local
cd backend
npm install
npm run migrate
npm run dev
```

Default local API: `http://127.0.0.1:8787`.

## Menjalankan Production (Single Port)

```bash
cd ..
cp .env.example .env
npm run env:production
cd backend
npm install
npm run migrate:production
npm run start
```

Jika `SERVE_DASHBOARD=true`, backend akan melayani build frontend dari folder `../dashboard/dist` di port yang sama.
Backend juga menjalankan proxy realtime MQTT -> SSE (`/api/v1/realtime/stream`) agar frontend tidak membutuhkan kredensial broker.
Publish command MQTT menggunakan koneksi broker persistent (single connection per process/isolate), sehingga tidak ada handshake WebSocket ulang per command.
Pada runtime Worker (Cloudflare), command publish dijalankan lewat Durable Object `MqttGatewayDurableObject` untuk menjaga koneksi broker tetap persisten lintas request.
Pada runtime Worker (Cloudflare), scheduler dipantik Cron Trigger lalu Durable Object alarm melakukan tick tiap detik agar interval jadwal `mm:ss` bisa berjalan tanpa menunggu menit berikutnya.
Pada runtime Worker (Cloudflare), endpoint SSE membuka subscribe MQTT langsung per koneksi stream.
Pada deploy Worker, frontend (`dashboard/dist`) ikut di-serve sebagai static assets pada URL Worker yang sama.
Jika kredensial MQTT backend tidak valid, endpoint command execute akan gagal publish dan merespons `502`.

## Scheduler

- Lokal Node.js memakai `SCHEDULER_INTERVAL_MS`; default template sekarang `1000` ms.
- Cloudflare Cron Trigger tetap memakai ekspresi menit (`* * * * *`) sebagai pemantik.
- Setelah dipantik, Durable Object `MQTT_GATEWAY` menjadwalkan alarm per detik untuk memproses jadwal berinterval detik.
- Window jadwal tetap berbasis rentang `HH:mm`; interval enforcement memakai format UI `mm:ss`.
- Nama kolom/field lama `window_start_minute`, `window_end_minute`, dan `enforce_every_minute` dipertahankan untuk kompatibilitas, tetapi nilai runtime-nya sekarang detik.

Kompatibilitas MQTT:
- Sistem hanya mendukung profile Tasmota.
- Publish command ke topik kanonik `cmnd/{deviceId}/POWER`.
- Realtime subscribe juga menangkap `stat/+/POWER(1..8)`, `stat/+/RESULT`, `tele/+/STATE`, `tele/+/LWT` (termasuk variasi urutan FullTopic).
- Asumsi prefix Tasmota: `cmnd/stat/tele` dengan FullTopic `%prefix%/%topic%/` atau `%topic%/%prefix%/`.

## Deploy Cloudflare Worker (Tetap Didukung)

```bash
cd ..
npm run deploy:worker
```

Catatan:
- `deploy:worker` akan build dashboard terlebih dulu, lalu deploy API + static assets ke Worker yang sama.
- Target default Worker adalah `lampupintar`.
- URL Worker menjadi satu endpoint untuk UI (`/`) dan API (`/api/*`): `https://lampupintar.afaavimala.workers.dev`.

Migrasi D1 remote dari root:

```bash
npm run migrate:remote
```

Konfigurasi cloud:
- `.env` (shared: `BACKEND_*`, `FRONTEND_*`, plus opsi deploy `CF_*`)
- `backend/wrangler.toml`
- D1 existing: `smartlamp_db` (`71be5235-fd72-4fb3-a646-b6a07e92b1d5`)
- `backend/.dev.vars.local.example`
- `backend/.worker.production.env.example`

## Environment File

- root: `.env` (generated from `.env.example`)
- `backend/.env.local.example`
- `backend/.env.production.example`

## Migrasi MariaDB

Migrasi SQL ada di:

- `backend/migrations-mariadb/`
- baseline saat ini: `backend/migrations-mariadb/0001_schema.sql`

Migrasi D1 ada di:

- `backend/migrations/`
- baseline saat ini: `backend/migrations/0001_schema.sql`

Runner migrasi:

- `backend/scripts/migrate-mariadb.mjs`

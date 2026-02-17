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
Pada runtime Worker (Cloudflare), endpoint SSE memakai fallback polling status DB.
Pada deploy Worker, frontend (`dashboard/dist`) ikut di-serve sebagai static assets pada URL Worker yang sama.
Jika kredensial MQTT backend tidak valid, endpoint command execute akan gagal publish dan merespons `502`.

## Deploy Cloudflare Worker (Tetap Didukung)

```bash
cd ..
npm run deploy:worker
```

Catatan:
- `deploy:worker` akan build dashboard terlebih dulu, lalu deploy API + static assets ke Worker yang sama.
- URL Worker menjadi satu endpoint untuk UI (`/`) dan API (`/api/*`).

Migrasi D1 remote dari root:

```bash
npm run migrate:remote
```

Konfigurasi cloud:
- `.env` (shared: `BACKEND_*`, `FRONTEND_*`, plus opsi deploy `CF_*`)
- `backend/wrangler.toml`
- `backend/.dev.vars.example`
- `backend/.worker.production.env.example`

## Environment File

- root: `.env` (generated from `.env.example`)
- `backend/.env.local.example`
- `backend/.env.production.example`

## Migrasi MariaDB

Migrasi SQL ada di:

- `backend/migrations-mariadb/`

Runner migrasi:

- `backend/scripts/migrate-mariadb.mjs`

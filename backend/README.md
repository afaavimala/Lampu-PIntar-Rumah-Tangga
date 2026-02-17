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

## Deploy Cloudflare Worker (Tetap Didukung)

```bash
cd ..
npm run deploy:worker
```

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

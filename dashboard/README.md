# SmartLamp Dashboard (Vite + React + TypeScript)

Frontend dashboard untuk kontrol device, monitoring status realtime, dan manajemen jadwal.

## Runtime Realtime

- Dashboard tidak konek broker MQTT langsung.
- Realtime menggunakan SSE dari backend:
  - `GET /api/v1/realtime/stream`
- Eksekusi command melalui backend:
  - `POST /api/v1/commands/execute`

## Environment

File env yang digunakan:
- `dashboard/.env.local`
- `dashboard/.env.production`

Key utama:
- `VITE_API_BASE_URL`
  - kosong (``) untuk same-origin (mode single port / Cloudflare single Worker)
  - isi URL backend jika frontend dipisah origin

## Development

Dari root:

```bash
npm run dev
```

Atau khusus dashboard:

```bash
cd dashboard
npm run dev -- --host 127.0.0.1 --port 5173
```

## Build

```bash
cd dashboard
npm run build
```

Output build:
- `dashboard/dist`

Folder ini dipakai oleh:
- Node production lokal (`SERVE_DASHBOARD=true`)
- Cloudflare Worker assets binding (`backend/wrangler.toml`)

## Catatan Deploy Cloudflare

Deploy default saat ini adalah single Worker (API + dashboard assets pada 1 URL):

```bash
npm run deploy:worker
```

Flow ini otomatis build dashboard sebelum upload Worker.

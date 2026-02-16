# Lampu Pintar Rumah Tangga

Sistem IoT lampu rumah tangga berbasis `ESP32 + HiveMQ + Cloudflare` dengan model:

- `Hybrid architecture`: control plane via HTTPS (Worker), data plane realtime via MQTT.
- `Multi-device ready`: topic dan data model tidak hardcoded untuk satu lampu.
- `Auto scheduling`: dukung jadwal ON/OFF otomatis berbasis cron + timezone.
- `100% free path`: Cloudflare free tier + broker free tier.
- `Mandatory framework`: backend `Hono`, frontend `Vite`.

## Framework Wajib

- Backend API harus menggunakan `Hono` di Cloudflare Workers.
- Frontend dashboard harus menggunakan `Vite` sebelum deploy ke Pages.

## Quick Start Scaffold (Hono + Vite)

```bash
# Backend (Hono on Cloudflare Workers)
npm create hono@latest backend

# Frontend (Vite)
npm create vite@latest dashboard
```

## Dukungan Deploy Lokal dan Cloudflare

Target deploy yang wajib didukung:

- Local development: `Hono Worker (wrangler dev)` + `Vite dev server`.
- Cloudflare production: `Workers` + `Pages`.

## Run Lokal

```bash
# Terminal 1: Backend API
cd backend
npm install
npx wrangler dev --local --port 8787

# Terminal 2: Frontend Dashboard
cd dashboard
npm install
VITE_API_BASE_URL=http://127.0.0.1:8787 npm run dev
```

Opsional untuk mengetes resource Cloudflare langsung saat dev:

```bash
cd backend
npx wrangler dev --remote
```

## Deploy Cloudflare

```bash
# Backend API -> Workers
cd backend
npx wrangler deploy

# Frontend -> Pages
cd dashboard
npm run build
npx wrangler pages deploy dist --project-name smartlamp-dashboard
```

Tambahan wajib production:

- Aktifkan `Cron Trigger` pada Worker untuk menjalankan scheduler periodik.

## Standar Testing dan Verifikasi (Playwright MCP)

Semua test UI/E2E dan verifikasi deploy wajib menggunakan `Playwright MCP` (bukan hanya cek manual).

Checklist minimum:

- Verifikasi local mode dengan Playwright MCP pada `http://127.0.0.1:5173`.
- Verifikasi cloud mode dengan Playwright MCP pada URL production Pages.
- Skenario wajib: login sukses/gagal, kontrol ON/OFF, status realtime, device offline, reconnect.
- Skenario scheduler wajib: create/edit/delete schedule, eksekusi cron otomatis, pause/resume schedule.
- Skenario waktu wajib: verifikasi timezone/DST dan dedup agar tidak double-execution.
- Simpan evidence hasil verifikasi (screenshot per skenario dan catatan pass/fail).

## Dokumen Utama

- Single source of truth: `Dokumentasi_Utama_SmartLamp_IoT.md`

## Alur Sistem

```text
ESP32 -- MQTT TLS --> HiveMQ Broker <-- MQTT WSS -- Dashboard (Cloudflare Pages)
                          ^
                          |
                 Signed command dari Cloudflare Worker (HTTPS API)
```

## API Control Plane (Worker)

- `POST /api/v1/auth/login`
- `GET /api/v1/bootstrap`
- `POST /api/v1/commands/sign`
- `POST /api/v1/schedules`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `PATCH /api/v1/schedules/{scheduleId}`
- `DELETE /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`
- `GET /api/v1/status` (fallback non-realtime)

## Open Integration API Standard

Endpoint publik untuk integrasi pihak ketiga:

- `GET /api/v1/integrations/capabilities`
- `GET /api/v1/devices`
- `GET /api/v1/devices/{deviceId}`
- `GET /api/v1/devices/{deviceId}/status`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`
- `GET /api/v1/openapi.json`

Aturan kontrak:

- API versioning wajib di prefix `/api/v1`.
- Auth mode: `Bearer JWT` atau `Bearer API key` (dengan scope).
- Mutating request harus pakai `Idempotency-Key`.
- Response JSON wajib envelope standar: `success`, `data`, `error`, `meta`.

## Status MQTT via WebSocket (Cloudflare <-> HiveMQ)

- Status: `didukung`.
- Realtime dashboard: browser dari Cloudflare Pages dapat konek ke HiveMQ via `wss://`.
- Scheduler backend: Worker dapat membuka koneksi WebSocket outbound ke broker untuk publish command terjadwal (dengan implementasi client MQTT yang kompatibel).

Contoh response sukses:

```json
{
  "success": true,
  "data": {
    "deviceId": "lampu-ruang-tamu",
    "power": "ON"
  },
  "error": null,
  "meta": {
    "requestId": "2d15f8fe-3f4f-4a0f-a6d9-38ee5f22e4a0",
    "timestamp": "2026-02-16T12:00:00Z",
    "version": "v1"
  }
}
```

## MQTT Topic Standard

- `home/{deviceId}/cmd` (QoS1, retain=false)
- `home/{deviceId}/status` (QoS1, retain=true)
- `home/{deviceId}/lwt` (QoS1, retain=true)

## Contoh Halaman

### Login Page

![Contoh Login Page](contoh-login-page.png)

### Dashboard

![Contoh Dashboard](contoh-dashboard.png)

# Playwright MCP Verification

Tanggal verifikasi:
- 16 February 2026: local development.
- 17 February 2026: local production single port + cloud single Worker.

## Target Uji

- Local development:
  - Frontend: `http://127.0.0.1:5173`
  - Backend: `http://127.0.0.1:8787`
- Local production single port:
  - App/API: `http://127.0.0.1:8080`
- Cloudflare production single Worker:
  - App/API: `https://smartlamp-backend.robert-rully.workers.dev`

## Ringkasan Hasil

1. Login gagal dengan password salah: `PASS`
2. Login sukses dengan seed user admin: `PASS`
3. Dashboard load + device card tampil: `PASS`
4. Realtime stream endpoint `/api/v1/realtime/stream` reachable: `PASS` (200)
5. Schedule create/list/runs dari UI: `PASS`
6. OpenAPI endpoint `GET /api/v1/openapi.json`: `PASS`
7. Open integration endpoint `GET /api/v1/devices`: `PASS`
8. Cloud single-Worker serve frontend di `/` + API same-origin `/api/*`: `PASS`
9. `POST /api/v1/commands/execute`: `FAIL` (502), root cause broker auth (`MQTT CONNACK code 5`)

## Tambahan Verifikasi API (Local, Non-Playwright)

1. Idempotency replay `POST /api/v1/commands/execute` dengan key sama + body sama: `PASS`.
2. Idempotency hash mismatch (key sama + body beda): `PASS` (409 `IDEMPOTENCY_CONFLICT`).
3. API key `demo-integration-key` untuk `GET /api/v1/devices`: `PASS`.
4. API key read-only (`scope=read`) untuk `POST /api/v1/commands/execute`: `PASS` (403 `FORBIDDEN_DEVICE_ACCESS`).
5. Rate limit `POST /api/v1/auth/login` (9x invalid, limit 8): `PASS` (429 `RATE_LIMITED`).
6. Rate limit `POST /api/v1/commands/execute` (31+ requests, limit 30): `PASS` (429 `RATE_LIMITED`).
7. Refresh token rotation `POST /api/v1/auth/refresh`:
   - refresh pertama sukses,
   - reuse token lama ditolak (401 `AUTH_INVALID_TOKEN`),
   - token refresh terbaru tetap valid: `PASS`.

## Evidence

- Screenshot dan snapshot diambil lewat Playwright MCP.
- Artefak tersimpan pada output sesi MCP runner (tidak disimpan permanen di root repository).

## Pending

1. Verifikasi end-to-end command ON/OFF `PASS` setelah kredensial MQTT broker valid.
2. Verifikasi realtime status/lwt end-to-end dari device fisik.
3. Verifikasi token expired dan skenario sesi jangka panjang via E2E script.

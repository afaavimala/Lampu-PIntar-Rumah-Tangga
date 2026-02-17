# Playwright MCP Verification

Tanggal verifikasi lokal: 16 February 2026  
Target lokal:
- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:8787`

## Hasil Skenario Local

1. Login gagal dengan password salah: `PASS`
2. Login sukses dengan seed user admin: `PASS`
3. Dashboard load + device card tampil: `PASS`
4. Schedule create/edit/delete dari UI: `PASS`
5. Schedule pause/resume: `PASS`
6. OpenAPI endpoint `GET /api/v1/openapi.json`: `PASS`
7. Open integration endpoint `GET /api/v1/devices`: `PASS`
8. Scheduler local trigger run record (`schedule_runs`): `PASS`  
   Catatan: publish MQTT gagal auth (`CONNACK code 5`) karena kredensial broker placeholder.

## Evidence Screenshot

- Screenshot diambil lewat Playwright MCP pada skenario login, dashboard, schedule, scheduler run, dan endpoint devices.
- Artefak screenshot tersimpan pada output sesi MCP runner (bukan disimpan permanen ke root repository).

## Pending (Belum Dieksekusi di Sesi Ini)

1. Verifikasi mode production lokal single port (backend + static frontend).
2. Verifikasi cloud production URL (Cloudflare Worker + Pages).
3. Verifikasi realtime status/lwt end-to-end dengan broker HiveMQ credential valid.
4. Verifikasi token expired, API-key scope negative test, dan idempotency replay behavior via E2E script.

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

# ARSITEKTUR SISTEM IOT LAMPU PINTAR RUMAH TANGGA

## ESP32 + HiveMQ + Cloudflare + Hono + Vite (Hybrid, Multi-Device, 100% Free Tier)

Tanggal Dokumen: 16 February 2026

---

# 1. Tujuan Sistem

Arsitektur ini digunakan untuk kontrol lampu rumah tangga secara realtime dengan baseline berikut:

- Topologi `Hybrid`: Worker untuk control plane, MQTT broker untuk data plane realtime.
- Skala `Multi-device`: tidak hardcoded ke `lampu1`.
- Broker `HiveMQ`: MQTT TLS untuk ESP32 dan MQTT over WebSocket (WSS) untuk dashboard.
- Framework backend wajib: `Hono` di atas Cloudflare Worker.
- Framework frontend wajib: `Vite` untuk build dashboard ke Cloudflare Pages.
- API bersifat `open integration` dengan standar kontrak REST yang stabil.
- Sistem mendukung `penjadwalan otomatis` ON/OFF berbasis waktu (cron + timezone).
- Keamanan command: `shared MQTT credential` + `signed payload (HMAC)` + `short expiry`.
- Biaya: tetap di jalur layanan gratis (Cloudflare Free + broker free tier).

---

# 2. Ringkasan Ekosistem

- `Vite App + Cloudflare Pages`: frontend dashboard (bundle/build via Vite).
- `Hono App + Cloudflare Worker`: login JWT, authorisasi device, sign command, audit log, dan scheduler runner.
- `Cloudflare D1`: users, devices, relasi user-device, dan command logs.
- `HiveMQ Broker`: bus pesan realtime MQTT.
- `ESP32 + Relay`: subscribe command, verifikasi signature, eksekusi ON/OFF, publish status.

## 2.1 Standar Framework (Wajib)

- Backend API wajib menggunakan `Hono` framework.
- Frontend dashboard wajib menggunakan `Vite` tooling.
- Endpoint API didaftarkan via routing Hono (bukan handler Worker mentah).

---

# 3. Arsitektur Tingkat Tinggi

## 3.1 Control Plane (HTTPS)

```text
Dashboard (Pages)
  -> POST /api/v1/auth/login
  -> POST /api/v1/auth/refresh
  -> GET  /api/v1/bootstrap
  -> POST /api/v1/commands/sign
  -> POST /api/v1/schedules
  -> GET  /api/v1/schedules
  -> GET  /api/v1/schedules/{scheduleId}
  -> PATCH /api/v1/schedules/{scheduleId}
  -> DELETE /api/v1/schedules/{scheduleId}
  -> GET  /api/v1/schedules/{scheduleId}/runs
  -> GET  /api/v1/status (fallback opsional)
  -> GET  /api/v1/devices
  -> GET  /api/v1/devices/{deviceId}/status

Cloudflare Worker
  -> validasi JWT
  -> cek akses user-device
  -> generate signed command envelope
  -> eksekusi scheduler trigger (due schedules)
  -> simpan audit ke D1
```

## 3.2 Data Plane (MQTT Realtime)

```text
ESP32 -- MQTT TLS ----\
                        > HiveMQ Broker
Dashboard -- MQTT WSS -/

Dashboard subscribe status/lwt
Dashboard publish command envelope signed ke topic cmd
ESP32 verifikasi signature + expiry + nonce sebelum kontrol relay
```

---

# 4. Alur Operasional Inti

## 4.1 Login

1. User input email/password di dashboard.
2. Dashboard kirim `POST /api/v1/auth/login`.
3. Worker verifikasi password hash di D1 (`bcrypt`, fallback legacy hash untuk migrasi).
4. Worker set access token cookie + refresh token cookie.

## 4.2 Refresh Session (Rotasi Token)

1. Saat access token expired, dashboard kirim `POST /api/v1/auth/refresh`.
2. Worker validasi refresh token cookie terhadap tabel `auth_sessions`.
3. Jika valid, Worker membuat refresh session baru dan merotasi session lama.
4. Worker menerbitkan access token baru + refresh token baru.

## 4.3 Bootstrap Session

1. Dashboard kirim `GET /api/v1/bootstrap` dengan JWT.
2. Worker return daftar device yang bisa diakses user.
3. Worker return konfigurasi MQTT WSS (host, port, topic pattern, kebijakan QoS/retain).
4. Dashboard konek ke HiveMQ via WSS dan subscribe topic status/lwt device yang dimiliki user.

## 4.4 Kontrol Lampu (Signed Command)

1. User klik ON/OFF pada device tertentu.
2. Dashboard request `POST /api/v1/commands/sign` ke Worker.
3. Worker validasi JWT + akses device, lalu menandatangani command envelope (HMAC).
4. Worker simpan audit command ke D1.
5. Dashboard publish envelope ke topic `home/{deviceId}/cmd`.
6. ESP32 verifikasi `sig`, `expiresAt`, dan `nonce`.
7. Jika valid, ESP32 kontrol relay dan publish status terbaru.

## 4.5 Realtime Status

1. ESP32 publish status ke `home/{deviceId}/status`.
2. ESP32 publish LWT online/offline ke `home/{deviceId}/lwt`.
3. Dashboard update UI langsung dari stream MQTT.
4. `GET /api/v1/status` dipakai sebagai fallback non-realtime (opsional).

## 4.6 Penjadwalan Otomatis (Scheduler)

1. User membuat jadwal ON/OFF per device via `POST /api/v1/schedules`.
2. Worker validasi JWT + akses user-device + validasi cron dan timezone.
3. Worker simpan rule jadwal ke D1 dan hitung `next_run_at`.
4. Scheduler trigger Worker berjalan periodik (misalnya per menit) untuk mengambil jadwal jatuh tempo.
5. Untuk setiap jadwal due, Worker membuat signed command envelope (HMAC) seperti command manual.
6. Worker publish command schedule ke broker (MQTT over WSS) ke topic `home/{deviceId}/cmd`.
7. ESP32 verifikasi signature, expiry, nonce, lalu eksekusi relay.
8. Worker simpan hasil eksekusi ke `schedule_runs` dan update `next_run_at`.

---

# 5. Kontrak MQTT Multi-Device

## 5.1 Topic Naming

- Command: `home/{deviceId}/cmd`
- Status: `home/{deviceId}/status`
- LWT: `home/{deviceId}/lwt`

## 5.2 QoS dan Retain

- `cmd`: QoS 1, retain = false
- `status`: QoS 1, retain = true
- `lwt`: QoS 1, retain = true

## 5.3 Payload Kontrak

### Command Sign Request (Dashboard -> Worker)

```ts
type CommandSignRequest = {
  deviceId: string;
  action: "ON" | "OFF";
  requestId: string;
};
```

### Command Envelope (Worker -> Dashboard -> MQTT cmd topic)

```ts
type CommandEnvelope = {
  deviceId: string;
  action: "ON" | "OFF";
  requestId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  sig: string;
};
```

### Device Status (ESP32 -> MQTT status topic)

```ts
type DeviceStatus = {
  deviceId: string;
  power: "ON" | "OFF";
  ts: number;
  rssi?: number;
  requestId?: string;
};
```

### Schedule Rule (API Scheduler)

```ts
type ScheduleRule = {
  id: string;
  deviceId: string;
  action: "ON" | "OFF";
  cron: string;
  timezone: string; // IANA tz, contoh: Asia/Jakarta
  enabled: boolean;
  nextRunAt: string; // ISO-8601 UTC
};
```

### Schedule Run Result

```ts
type ScheduleRun = {
  scheduleId: string;
  plannedAt: string;
  executedAt?: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  requestId?: string;
  reason?: string;
};
```

---

# 6. API Contract Worker

## 6.1 POST /api/v1/auth/login

Fungsi:
- autentikasi user
- return JWT untuk control plane

## 6.2 POST /api/v1/auth/refresh

Fungsi:
- refresh access token saat expired
- rotasi refresh session (old session revoked, new session issued)

## 6.3 GET /api/v1/bootstrap

Fungsi:
- return daftar device user
- return konfigurasi MQTT WSS untuk dashboard

Response minimal:
- `devices[]`
- `mqtt.host`
- `mqtt.port`
- `mqtt.clientId`
- `mqtt.topicPatterns`

## 6.4 POST /api/v1/commands/sign

Fungsi:
- validasi JWT
- validasi akses user ke device
- generate signed command envelope
- simpan audit command

## 6.5 Scheduler Endpoints

- `POST /api/v1/schedules`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `PATCH /api/v1/schedules/{scheduleId}`
- `DELETE /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`

Fungsi:
- membuat dan mengelola jadwal otomatis ON/OFF.
- menyimpan history eksekusi schedule.
- mendukung kontrol pause/resume via field `enabled`.

## 6.6 GET /api/v1/status (Opsional Fallback)

Fungsi:
- memberi snapshot status saat dashboard baru masuk/reconnect
- bukan sumber realtime utama

## 6.7 Open Integration Endpoints

- `GET /api/v1/integrations/capabilities`
- `GET /api/v1/devices`
- `GET /api/v1/devices/{deviceId}`
- `GET /api/v1/devices/{deviceId}/status`
- `GET /api/v1/schedules`
- `GET /api/v1/schedules/{scheduleId}`
- `GET /api/v1/schedules/{scheduleId}/runs`
- `GET /api/v1/openapi.json`

Tujuan:
- memberi kontrak API publik yang stabil untuk pihak ketiga
- discovery fitur yang tersedia
- dokumentasi schema yang bisa di-generate client otomatis

## 6.8 Standar Kontrak API (Open Integration)

### Versi API

- Prefix wajib: `/api/v1`.
- Perubahan breaking harus melalui versi baru (`/api/v2`), bukan mengganti kontrak v1.

### Header Wajib

- `Content-Type: application/json`
- `Authorization: Bearer <jwt_or_api_key>`
- `X-Request-Id: <uuid>` (disarankan)
- `Idempotency-Key: <uuid>` untuk request mutasi (`POST /commands/sign`, `POST /schedules`, `PATCH /schedules/{id}`, `DELETE /schedules/{id}`)

### Mode Autentikasi Open Integration

- `JWT`: untuk dashboard/session user.
- `API Key`: untuk service-to-service integrasi pihak ketiga.
- API key harus disimpan dalam bentuk hash (`api_key_hash`) dan dibatasi dengan scope.

### Response Envelope

Semua response JSON mengikuti envelope standar:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-02-16T12:00:00Z",
    "version": "v1"
  }
}
```

### Error Envelope

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "FORBIDDEN_DEVICE_ACCESS",
    "message": "User has no access to this device",
    "details": {}
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-02-16T12:00:00Z",
    "version": "v1"
  }
}
```

### Kode Error Minimum

- `AUTH_INVALID_TOKEN`
- `AUTH_EXPIRED_TOKEN`
- `FORBIDDEN_DEVICE_ACCESS`
- `DEVICE_NOT_FOUND`
- `VALIDATION_ERROR`
- `SCHEDULE_NOT_FOUND`
- `SCHEDULE_INVALID_CRON`
- `SCHEDULE_INVALID_TIMEZONE`
- `IDEMPOTENCY_CONFLICT`
- `RATE_LIMITED`

---

# 7. Skema Database D1 (Revisi)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT,
  hmac_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE user_devices (
  user_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE command_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE integration_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_body TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at INTEGER,
  rotated_at INTEGER,
  revoked_at INTEGER,
  replaced_by_session_id INTEGER,
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (replaced_by_session_id) REFERENCES auth_sessions(id)
);

CREATE TABLE rate_limit_hits (
  rate_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE device_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- ON | OFF
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL, -- IANA timezone
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL, -- unix epoch UTC
  last_run_at INTEGER,
  start_at INTEGER,
  end_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  planned_at INTEGER NOT NULL,
  executed_at INTEGER,
  request_id TEXT,
  status TEXT NOT NULL, -- SUCCESS | FAILED | SKIPPED
  error_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(schedule_id, planned_at),
  FOREIGN KEY (schedule_id) REFERENCES device_schedules(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX idx_device_schedules_due
ON device_schedules (enabled, next_run_at);

CREATE INDEX idx_schedule_runs_schedule_id
ON schedule_runs (schedule_id, planned_at);

CREATE INDEX idx_auth_sessions_user_active
ON auth_sessions (user_id, revoked_at, expires_at);

CREATE INDEX idx_auth_sessions_expires
ON auth_sessions (expires_at);

CREATE INDEX idx_rate_limit_hits_reset
ON rate_limit_hits (reset_at);
```

---

# 8. Model Keamanan

## 8.1 Identitas dan Akses

- User auth memakai JWT.
- Session auth menggunakan access token TTL pendek + refresh token rotation.
- Authorisasi command selalu diverifikasi di Worker berdasarkan tabel `user_devices`.
- Operasi schedule (`create/update/delete`) wajib melewati validasi akses user-device yang sama.

## 8.2 Shared Broker Credential (Keputusan Fase Ini)

- Dashboard dan ESP32 bisa memakai credential broker yang sama.
- Mitigasi wajib: command tidak boleh raw publish.
- Semua command wajib berupa signed envelope dari Worker.

## 8.3 Anti-Spoof dan Anti-Replay

ESP32 wajib reject command jika:
- signature tidak valid
- `expiresAt` sudah lewat
- `nonce` pernah dipakai sebelumnya dalam jendela waktu aktif
- command schedule diperlakukan sama seperti command manual (wajib signature valid).

## 8.4 Secret Handling

- JWT secret dan parameter HMAC disimpan di secret environment Worker.
- HMAC secret per-device disimpan di D1 dan tidak boleh diekspos ke frontend.

## 8.5 Password dan Rate Limit

- Password user diverifikasi dengan `bcrypt` (`$2b$...`) di Worker.
- Legacy hash `SHA-256` masih didukung sementara untuk kompatibilitas seed lama, lalu auto-upgrade ke bcrypt setelah login sukses.
- Rate limit wajib aktif minimal untuk:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/commands/sign`
- Error untuk limit terlampaui menggunakan code `RATE_LIMITED` + `retry-after`.

---

# 9. Reliabilitas Realtime

- Dashboard wajib auto-reconnect MQTT WSS.
- Setelah reconnect, dashboard wajib resubscribe seluruh topic device.
- Sinkron state awal memakai retained `status`/`lwt`.
- Device offline dideteksi dari LWT.
- Scheduler runner harus idempotent (mencegah eksekusi ganda pada menit yang sama).
- Perhitungan jadwal harus berbasis timezone IANA untuk menangani DST secara konsisten.

---

# 10. Dukungan Deployment (Lokal + Cloudflare)

Arsitektur ini wajib didukung pada dua mode deploy dengan codebase yang sama:

- Local development.
- Cloudflare production.

## 10.1 Local Development

1. Inisialisasi backend Worker dengan template `Hono`.
2. Inisialisasi frontend dashboard menggunakan `Vite`.
3. Copy env lokal Worker dari `backend/.dev.vars.local.example` ke `backend/.dev.vars`.
4. Copy env frontend dari `dashboard/.env.example` ke `dashboard/.env.local`.
5. Jalankan API lokal: `wrangler dev --local --port 8787`.
6. Jalankan frontend lokal: `npm run dev` (Vite, default port 5173).
7. Set `VITE_API_BASE_URL=http://127.0.0.1:8787` untuk mode lokal.
8. Jika perlu akses resource Cloudflare langsung saat development, gunakan `wrangler dev --remote`.
9. Verifikasi alur login, sign command, publish MQTT WSS, dan update status realtime.
10. Uji endpoint scheduler (`/api/v1/schedules`) dan simulasi eksekusi due schedule di environment lokal.

## 10.2 Cloudflare Deployment

1. Deploy API Hono Worker ke Cloudflare Workers: `wrangler deploy`.
2. Build frontend Vite: `npm run build`.
3. Deploy frontend ke Cloudflare Pages.
4. Gunakan template env production Worker di `backend/.worker.production.env.example`.
5. Bind D1 database dan secret environment di Worker.
6. Set var non-secret (cookie/cors/rate-limit) dan secret (`JWT_SECRET`, `MQTT_*`, `HMAC_*`) menggunakan Wrangler.
7. Aktifkan `Cron Triggers` pada Worker untuk scheduler runner periodik (misalnya setiap menit).
8. Set `VITE_API_BASE_URL` ke URL Worker production.
9. Verifikasi end-to-end pada domain production termasuk eksekusi jadwal otomatis.

## 10.3 Metode Verifikasi Wajib

- Semua verifikasi UI dan E2E dilakukan menggunakan `Playwright MCP`.
- Verifikasi dilakukan minimal pada 2 target:
  - local environment
  - production Cloudflare
- Hasil verifikasi wajib menyertakan evidence pass/fail per skenario.

---

# 11. Kriteria Sukses

- Multi-device berfungsi dengan topic pattern dinamis.
- Realtime update berjalan via MQTT WSS tanpa polling utama.
- Worker tidak menjadi long-lived MQTT bridge.
- Command tanpa signature ditolak di firmware.
- Audit command tersimpan di D1.
- Scheduler otomatis ON/OFF berjalan stabil berbasis cron + timezone.
- Open Integration API v1 tersedia dengan kontrak stabil dan endpoint discovery.
- OpenAPI JSON tersedia di `/api/v1/openapi.json`.
- Semua skenario kritikal lulus verifikasi melalui Playwright MCP pada local dan production.

---

# 12. Catatan Scope

- Arsitektur ini ditujukan untuk dashboard web sebagai klien utama.
- Native mobile app tidak termasuk scope fase ini.

---

# 13. Blueprint dan TODO Implementasi (Inline)

## 13.1 PHASE 1 - Hardware dan Provisioning Device

- [ ] Rakit ESP32 + relay + lampu.
- [ ] Tetapkan `deviceId` unik per board.
- [ ] Konfigurasi WiFi dan broker endpoint.
- [ ] Uji manual ON/OFF relay lokal.

## 13.2 PHASE 2 - Firmware ESP32

- [ ] Implement MQTT TLS connect + reconnect.
- [ ] Subscribe `home/{deviceId}/cmd`.
- [ ] Implement verifikasi signature HMAC command.
- [ ] Implement validasi expiry + nonce anti-replay.
- [ ] Publish `status` retained setelah setiap perubahan state.
- [ ] Konfigurasi LWT `ONLINE/OFFLINE`.

## 13.3 PHASE 3 - Backend Worker (Hono)

- [x] Scaffold backend pakai Hono (`npm create hono@latest`).
- [x] Konfigurasi target Cloudflare Workers + Wrangler.
- [x] Setup binding D1 di konfigurasi Worker.
- [x] Pastikan API bisa jalan lokal via `wrangler dev --local --port 8787`.
- [x] Implement route v1 `POST /api/v1/auth/login` + JWT.
- [x] Implement route v1 `POST /api/v1/auth/refresh` + refresh token rotation.
- [x] Implement route v1 `GET /api/v1/bootstrap` (device list + MQTT config).
- [x] Implement route v1 `POST /api/v1/commands/sign`.
- [x] Implement route v1 `POST /api/v1/schedules`.
- [x] Implement route v1 `GET /api/v1/schedules`.
- [x] Implement route v1 `GET /api/v1/schedules/{scheduleId}`.
- [x] Implement route v1 `PATCH /api/v1/schedules/{scheduleId}`.
- [x] Implement route v1 `DELETE /api/v1/schedules/{scheduleId}`.
- [x] Implement route v1 `GET /api/v1/schedules/{scheduleId}/runs`.
- [x] Implement route v1 `GET /api/v1/status` fallback snapshot.
- [x] Implement endpoint integrasi `GET /api/v1/integrations/capabilities`.
- [x] Implement endpoint integrasi `GET /api/v1/devices`.
- [x] Implement endpoint integrasi `GET /api/v1/devices/{deviceId}`.
- [x] Implement endpoint integrasi `GET /api/v1/devices/{deviceId}/status`.
- [x] Implement `GET /api/v1/openapi.json`.
- [x] Implement scheduler runner pada Worker Cron Trigger.
- [x] Implement kalkulasi `next_run_at` (cron + timezone IANA).
- [x] Implement log eksekusi jadwal ke `schedule_runs`.
- [x] Implement publish command schedule ke topic `home/{deviceId}/cmd`.
- [x] Implement middleware response envelope standar (`success/data/error/meta`).
- [x] Implement API key auth + scope check untuk akses integrasi.
- [x] Implement idempotency middleware untuk endpoint mutasi.
- [x] Implement audit ke `command_logs`.

## 13.4 PHASE 4 - Dashboard Frontend (Vite)

- [x] Scaffold frontend pakai Vite (`npm create vite@latest`).
- [x] Setup env var API base URL dan MQTT config.
- [x] Pastikan dashboard bisa jalan lokal via `npm run dev` dan hit API lokal.
- [x] Halaman login + secure token handling.
- [x] Device list dinamis multi-device.
- [x] MQTT WSS client + auto reconnect.
- [x] Subscribe status/lwt sesuai akses user.
- [x] Request sign command ke Worker lalu publish ke broker.
- [x] Tampilkan ack status dan offline indicator per device.
- [x] Tambahkan UI manajemen jadwal (buat/list/edit/hapus jadwal).
- [x] Tampilkan status next run dan riwayat eksekusi schedule di dashboard.

## 13.5 PHASE 5 - Security Hardening

- [x] Password hash kuat (Argon2/Bcrypt di Worker pipeline).
- [x] JWT expiry pendek + refresh policy sesuai kebutuhan.
- [x] CORS restrict hanya origin dashboard.
- [x] Rate limit endpoint auth/sign.
- [x] Simpan semua secret di environment Worker.

## 13.6 PHASE 6 - Testing dan Validasi

- [x] Semua test UI/E2E dijalankan via Playwright MCP (bukan verifikasi manual saja).
- [x] Test local mode: dashboard Vite + API Hono (`wrangler dev`) berjalan end-to-end.
- [ ] Test cloud mode: deploy Worker + Pages dan verifikasi end-to-end.
- [x] Verifikasi kontrak Open Integration API v1 (status code, envelope JSON, error code).
- [x] Verifikasi endpoint `GET /api/v1/openapi.json` dapat diakses dan valid.
- [x] Verifikasi API key scope membatasi akses endpoint sesuai role.
- [x] Verifikasi idempotency key mengembalikan response konsisten untuk request duplikat.
- [x] Verifikasi create/update/delete schedule dari dashboard berjalan.
- [x] Verifikasi scheduler mengeksekusi ON/OFF otomatis sesuai cron.
- [ ] Verifikasi timezone/DST tidak menggeser jadwal secara tidak valid.
- [x] Verifikasi schedule pause/resume via field `enabled`.
- [ ] Verifikasi retry dan dedup mencegah double-execution (`schedule_runs` unik per slot waktu).
- [x] Login benar/salah.
- [ ] Token expired.
- [ ] User A tidak bisa sign command device User B.
- [ ] Signature tampered ditolak ESP32.
- [ ] Replay command ditolak (nonce/expiry).
- [ ] Device offline tampil realtime dari LWT.
- [ ] Reconnect dashboard: resubscribe + state sinkron.
- [ ] Uji paralel minimal 10 device.
- [ ] Catat latency end-to-end command sampai status ack.
- [x] Simpan evidence Playwright MCP (screenshot dan catatan pass/fail per skenario).

Catatan verifikasi terakhir:
- Tanggal: 16 February 2026 (local).
- Tool: Playwright MCP.
- Evidence screenshot local: tersimpan pada output sesi Playwright MCP runner (artefak sesi, tidak disimpan permanen di root repo).
- Verifikasi tambahan API local: API key scope, idempotency replay/mismatch, rate-limit auth/sign, dan refresh token rotation (lihat `PLAYWRIGHT_VERIFICATION.md`).
- Cloud verification belum dijalankan karena URL production belum disediakan pada sesi ini.

---

# 14. Definition of Done (Inline)

- [x] Semua endpoint utama tersedia dan terdokumentasi.
- [x] Multi-device berjalan tanpa hardcoded topic.
- [x] Signed command diberlakukan end-to-end.
- [ ] Dashboard realtime via MQTT WSS stabil.
- [x] Manajemen jadwal otomatis berfungsi (create/edit/delete/pause/resume).
- [x] Scheduler Cron Trigger mengeksekusi command terjadwal sesuai timezone.
- [x] API berjalan di Hono Worker dan frontend dibangun via Vite.
- [ ] Deployment lokal dan deployment Cloudflare sama-sama lulus smoke test.
- [ ] Verifikasi E2E local + cloud lulus melalui Playwright MCP.
- [x] Open Integration API v1 terdokumentasi dan lulus contract verification.
- [x] Audit command tersimpan di D1.
- [ ] Demo end-to-end berjalan penuh di jalur free tier.

---

# 15. Verifikasi MQTT via WebSocket (Cloudflare <-> HiveMQ)

Status verifikasi: `DIDUKUNG` dengan konfigurasi yang benar.

Ringkasan teknis:
- HiveMQ menyediakan endpoint TLS WebSocket untuk client web.
- HiveMQ broker mendukung listener MQTT over WebSocket dan subprotocol MQTT.
- Cloudflare Workers mendukung WebSocket client (`new WebSocket(...)`) dan upgrade `ws/wss` via `fetch` extension.
- Outbound WebSocket dari Worker mengikuti limit koneksi HTTP per invocation (maksimal 6 koneksi simultan).

Implikasi arsitektur:
- `Cloudflare Pages (browser) -> HiveMQ (WSS)` didukung untuk realtime dashboard.
- `Cloudflare Worker Scheduler -> HiveMQ (WSS)` didukung untuk publish command terjadwal, selama client/protokol MQTT di Worker kompatibel.

Guardrails implementasi:
- Gunakan endpoint `wss://` resmi dari HiveMQ cluster.
- Gunakan subprotocol MQTT yang sesuai (`mqtt`/`mqttv3.1`) bila diperlukan listener broker.
- Hindari desain Worker sebagai long-lived bridge; gunakan koneksi pendek per eksekusi schedule.

---

# 16. Contoh Tampilan

## 16.1 Login Page

![Contoh Login Page](contoh-login-page.png)

## 16.2 Dashboard

![Contoh Dashboard](contoh-dashboard.png)

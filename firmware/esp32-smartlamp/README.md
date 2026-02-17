# ESP32 SmartLamp Firmware (Reference)

Firmware referensi untuk checklist Phase 2:

- MQTT TLS connect + reconnect
- Subscribe topic command `home/{deviceId}/cmd`
- Verifikasi signature HMAC command
- Validasi expiry + nonce anti-replay
- Publish status retained ke `home/{deviceId}/status`
- Konfigurasi LWT `ONLINE/OFFLINE` ke `home/{deviceId}/lwt`

File utama:
- `firmware/esp32-smartlamp/esp32-smartlamp.ino`

## Dependency Arduino

- `PubSubClient`
- `ArduinoJson`

## Konfigurasi yang wajib diisi

Ubah nilai di bagian `CONFIGURATION` pada sketch:

- `WIFI_SSID`, `WIFI_PASSWORD`
- `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`
- `DEVICE_ID`
- `HMAC_SECRET`

## Catatan penting

- Default TLS di sketch menggunakan `setInsecure()` untuk memudahkan bootstrap awal.
- Untuk produksi, ganti dengan sertifikat CA broker yang valid (`setCACert`).
- Firmware ini referensi implementasi; validasi hardware in-field tetap wajib.

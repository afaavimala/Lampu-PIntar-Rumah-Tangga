# Diagram Arsitektur Ekosistem SmartLamp IoT

Dokumen ini merangkum arsitektur aktual berdasarkan implementasi pada:

- `backend/src/server.ts`
- `backend/src/index.ts`
- `backend/src/routes/*.ts`
- `backend/src/lib/{mqtt-ws,realtime-mqtt-proxy,scheduler-runner,auth,session}.ts`
- `firmware/esp32-smartlamp/esp32-smartlamp.ino`
- `dashboard/src/lib/{api,realtime}.ts`
- `backend/migrations/*.sql`
- `docs/diagram/{diagram.html,blueprint.svg,arsitektur.svg}`

Artefak visual terkonsolidasi pada satu folder:
- `docs/diagram/diagram.html`
- `docs/diagram/blueprint.svg`
- `docs/diagram/arsitektur.svg`

## 1) Arsitektur Menyeluruh (Lokal + Cloud)

```mermaid
flowchart TB
  subgraph Clients["Clients"]
    USER["Pengguna"]
    FE["Dashboard Web<br/>React + Vite"]
    INT["Integration Client<br/>(API Key/Bearer)"]
  end

  subgraph NodeRuntime["Runtime A: Node.js (Local/On-Prem)"]
    API_NODE["Hono API"]
    RT_PROXY["Realtime MQTT Proxy<br/>(persistent MQTT over WSS)"]
    SCH_NODE["Scheduler Runner<br/>(setInterval)"]
    STATIC_NODE["Static Asset Server"]
  end

  subgraph WorkerRuntime["Runtime B: Cloudflare Worker"]
    API_WKR["Hono API (Worker Fetch)"]
    RT_WKR["SSE Realtime Engine<br/>(MQTT subscribe per stream + LWT snapshot over WSS)"]
    SCH_CRON["Cron Trigger"]
    ASSETS["Workers Assets Binding"]
  end

  subgraph DataPlane["Data & Messaging Services"]
    BROKER["HiveMQ Broker"]
    DB_MARIA["MariaDB"]
    DB_D1["Cloudflare D1"]
  end

  subgraph Edge["Edge Device Domain"]
    WIFI["Wi-Fi AP/Router"]
    NTP["NTP Server<br/>(pool.ntp.org / time.nist.gov)"]
    ESP["ESP32 SmartLamp + Relay"]
    TASMOTA_EDGE["Tasmota Device"]
  end

  USER --> FE

  FE -->|"HTTPS REST (JSON) + Cookie JWT/Refresh"| API_NODE
  FE -->|"SSE (text/event-stream)<br/>/api/v1/realtime/stream"| API_NODE

  FE -->|"HTTPS REST (JSON) + Cookie JWT/Refresh"| API_WKR
  FE -->|"SSE (text/event-stream)<br/>/api/v1/realtime/stream"| API_WKR

  INT -->|"HTTPS REST + Bearer API Key"| API_NODE
  INT -->|"HTTPS REST + Bearer API Key"| API_WKR

  API_NODE -->|"SQL over TCP (3306)"| DB_MARIA
  SCH_NODE -->|"SQL"| DB_MARIA
  RT_PROXY -->|"MQTT 3.1.1 over WSS<br/>wss://...:8884/mqtt"| BROKER
  API_NODE -->|"MQTT 3.1.1 over WSS<br/>Publish command"| BROKER
  SCH_NODE -->|"MQTT 3.1.1 over WSS<br/>Publish scheduled command"| BROKER
  STATIC_NODE -->|"Serve SPA assets"| FE
  API_NODE --> RT_PROXY
  API_NODE --> SCH_NODE

  API_WKR -->|"D1 Binding"| DB_D1
  RT_WKR -->|"D1 initial status snapshot"| DB_D1
  RT_WKR -->|"MQTT 3.1.1 over WSS<br/>subscribe status/lwt + LWT snapshot"| BROKER
  SCH_CRON -->|"scheduled() -> runDueSchedules()"| API_WKR
  ASSETS -->|"Serve SPA assets"| FE
  API_WKR --> RT_WKR

  ESP --> WIFI
  ESP -->|"NTP (UDP/123)"| NTP
  ESP <-->|"MQTT over TLS (TCP/8883)<br/>cmd/status/lwt"| BROKER
  TASMOTA_EDGE <-->|"MQTT<br/>cmnd/stat/tele"| BROKER
```

## 2) Detail Komunikasi dan Protokol

| Jalur | Arah | Protokol | Endpoint/Topic | Payload utama |
|---|---|---|---|---|
| Dashboard -> Backend | Browser ke API | HTTPS REST + JSON | `/api/v1/auth/*`, `/api/v1/bootstrap`, `/api/v1/commands/*`, `/api/v1/schedules*`, `/api/v1/devices*`, `/api/v1/status` | JSON request/response |
| Backend -> Dashboard | API ke Browser | SSE (`text/event-stream`) | `/api/v1/realtime/stream` | Event `hello`, `ping`, `status`, `lwt` |
| Integrasi eksternal -> Backend | Client integrasi ke API | HTTPS REST + Bearer API Key | `/api/v1/integrations/capabilities`, `/api/v1/devices*`, `/api/v1/schedules*`, dll | JSON |
| Backend -> Broker | Hono runtime ke HiveMQ | MQTT 3.1.1 over WSS (`mqtt` subprotocol) | `cmnd/{deviceId}/POWER`, `{deviceId}/cmnd/POWER` | payload `ON/OFF` (profile Tasmota) |
| Broker -> Backend (Node) | HiveMQ ke realtime proxy | MQTT 3.1.1 over WSS subscribe | `home/+/status`, `home/+/lwt`, `stat/+/POWER(1..8)`, `+/stat/POWER(1..8)`, `stat/+/RESULT`, `+/stat/RESULT`, `tele/+/STATE`, `+/tele/STATE`, `tele/+/LWT`, `+/tele/LWT` | JSON status + string LWT |
| ESP32 <-> Broker | Device ke HiveMQ | MQTT over TLS (TCP/8883) | `home/{deviceId}/cmd`, `home/{deviceId}/status`, `home/{deviceId}/lwt` | Command JSON, status JSON, LWT string |
| Tasmota <-> Broker | Device Tasmota ke broker | MQTT | `cmnd/{topic}/POWER`, `stat/{topic}/POWER|RESULT`, `tele/{topic}/STATE|LWT` | payload `ON/OFF`, JSON state, LWT `Online/Offline` |
| Node Backend -> MariaDB | App server ke DB | MariaDB protocol (TCP/3306) | tabel aplikasi | data auth/device/schedule/log |
| Worker Backend -> D1 | Worker ke DB cloud | Cloudflare D1 binding | tabel aplikasi | data auth/device/schedule/log |

## 3) Kontrak MQTT per Device

```mermaid
flowchart LR
  STATUS["home/{deviceId}/status<br/>JSON DeviceStatus"]
  LWT["home/{deviceId}/lwt<br/>ONLINE/OFFLINE"]
  TCMND["cmnd/{deviceId}/POWER<br/>ON/OFF"]
  TSTAT["stat/{deviceId}/POWER|RESULT<br/>Tasmota state"]
  TTELE["tele/{deviceId}/STATE|LWT<br/>Tasmota teleperiod+lwt"]

  API["Backend Command API / Scheduler"] --> TCMND
  ESP["ESP32 Firmware"] --> STATUS
  ESP --> LWT
  STATUS --> RT["Realtime MQTT Reader<br/>(Node proxy / Worker per-stream)"]
  LWT --> RT
  TSTAT --> RT
  TTELE --> RT
  TCMND --> TASMOTA["Tasmota Device"]
  RT --> SSE["SSE Stream ke Dashboard"]
```

`CommandDispatch`:

```json
{
  "deviceId": "lampu-ruang-tamu",
  "action": "ON",
  "requestId": "uuid"
}
```

## 4) Sequence: Kontrol Lampu Manual (ON/OFF)

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant FE as Dashboard (Browser)
  participant API as Hono API
  participant DB as MariaDB/D1
  participant MQ as HiveMQ Broker
  participant ESP as ESP32

  U->>FE: Klik ON/OFF
  FE->>API: POST /api/v1/commands/execute\n(Cookie JWT + Idempotency-Key)
  API->>DB: Validasi user/device access
  API->>MQ: PUBLISH QoS1 cmnd/{deviceId}/POWER (+ {deviceId}/cmnd/POWER)
  API->>DB: INSERT command_logs(result=PUBLISHED)
  MQ->>ESP: Deliver command profile sesuai device
  ESP->>ESP: Tasmota execute POWER
  ESP->>MQ: PUBLISH status (home/{deviceId}/status atau stat/{topic}/POWER|RESULT, tele/{topic}/STATE)
  ESP->>MQ: Publish/maintain LWT (home/{deviceId}/lwt atau tele/{topic}/LWT)
  MQ-->>API: status/lwt event (Node proxy atau Worker per-stream subscribe)
  API-->>FE: SSE event type=status/lwt
```

## 5) Sequence: Realtime Stream (Node vs Worker)

```mermaid
sequenceDiagram
  autonumber
  participant FE as Dashboard
  participant API as /api/v1/realtime/stream
  participant DB as MariaDB/D1
  participant RP as Node Realtime Proxy
  participant MQ as HiveMQ

  rect rgb(230, 243, 255)
    Note over FE,MQ: Mode Node.js lokal
    FE->>API: Open SSE
    API->>DB: Initial status snapshot (listBestStatus)
    API->>RP: subscribe(deviceIds)
    RP->>MQ: SUBSCRIBE home/* + stat/* + tele/* (+ variasi FullTopic)
    MQ-->>RP: PUBLISH status/lwt
    RP-->>API: callback event
    API-->>FE: SSE delta status/lwt
  end

  rect rgb(245, 245, 235)
    Note over FE,MQ: Mode Cloudflare Worker (per-connection MQTT)
    FE->>API: Open SSE
    API->>MQ: Open MQTT WSS client per stream
    API->>MQ: SUBSCRIBE home/* + stat/* + tele/* (+ variasi FullTopic)
    MQ-->>API: PUBLISH status/lwt
    API-->>FE: SSE delta status/lwt
    API->>MQ: readLwtSnapshotOverWs(deviceIds) untuk bootstrap LWT retained
  end
```

## 6) Sequence: Scheduler Otomatis

```mermaid
sequenceDiagram
  autonumber
  participant T as Trigger<br/>(setInterval / Cron Trigger)
  participant SCH as Scheduler Runner
  participant DB as MariaDB/D1
  participant MQ as HiveMQ
  participant ESP as ESP32

  T->>SCH: runDueSchedules()
  SCH->>DB: SELECT due schedules (enabled + next_run_at <= now)
  SCH->>DB: INSERT schedule_runs (idempotent by unique schedule_id+planned_at)
  SCH->>MQ: PUBLISH QoS1 cmnd/{deviceId}/POWER (+ {deviceId}/cmnd/POWER)
  MQ->>ESP: command schedule
  ESP->>ESP: execute relay
  SCH->>DB: UPDATE schedule_runs SUCCESS/FAILED
  SCH->>DB: UPDATE device_schedules next_run_at (+ last_run_at)
```

## 7) ERD Ringkas Database

```mermaid
erDiagram
  USERS ||--o{ USER_DEVICES : owns_access
  DEVICES ||--o{ USER_DEVICES : mapped_to_user
  USERS ||--o{ AUTH_SESSIONS : creates
  USERS ||--o{ DEVICE_SCHEDULES : creates
  DEVICES ||--o{ DEVICE_SCHEDULES : target_device
  DEVICE_SCHEDULES ||--o{ SCHEDULE_RUNS : produces
  DEVICES ||--o{ SCHEDULE_RUNS : executed_on
  USERS ||--o{ COMMAND_LOGS : triggers
  DEVICES ||--o{ COMMAND_LOGS : logged_for

  USERS {
    int id PK
    string email
    string password_hash
    string created_at
  }
  DEVICES {
    int id PK
    string device_id UK
    string name
    string location
  }
  USER_DEVICES {
    int user_id PK,FK
    int device_id PK,FK
    string role
  }
  AUTH_SESSIONS {
    int id PK
    int user_id FK
    string refresh_token_hash UK
    int expires_at
    int revoked_at
    int rotated_at
  }
  DEVICE_SCHEDULES {
    int id PK
    int user_id FK
    int device_id FK
    string action
    string cron_expr
    string timezone
    int next_run_at
    int last_run_at
  }
  SCHEDULE_RUNS {
    int id PK
    int schedule_id FK
    int device_id FK
    int planned_at
    int executed_at
    string status
    string request_id
  }
  COMMAND_LOGS {
    int id PK
    string request_id
    int user_id FK
    int device_id FK
    string action
    int issued_at
    int expires_at
    string result
  }
  INTEGRATION_CLIENTS {
    int id PK
    string name
    string api_key_hash UK
    string scopes
    bool is_active
  }
  IDEMPOTENCY_RECORDS {
    int id PK
    string idempotency_key UK
    string route
    string request_hash
    string response_body
    int status_code
  }
  RATE_LIMIT_HITS {
    string rate_key PK
    int request_count
    int reset_at
  }
```

## 8) Ringkasan Security Layer yang Terlibat

- Session auth: JWT HS256 untuk access token (`auth_token`) + opaque refresh token (`refresh_token`) di cookie HttpOnly.
- Idempotency API mutasi: header `Idempotency-Key` (server simpan `idempotency_records`).
- Rate limit: login dan command execute (`rate_limit_hits`).

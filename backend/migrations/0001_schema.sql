-- Consolidated D1 baseline schema (auth + rate limit + schedule enforcement window).

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  location TEXT,
  hmac_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_devices (
  user_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS command_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  user_id INTEGER,
  device_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS integration_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_body TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  rate_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
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

CREATE TABLE IF NOT EXISTS device_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  start_at INTEGER,
  end_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  planned_at INTEGER NOT NULL,
  executed_at INTEGER,
  request_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(schedule_id, planned_at),
  FOREIGN KEY (schedule_id) REFERENCES device_schedules(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

-- Backward-compatible schedule enforcement columns.
ALTER TABLE device_schedules ADD COLUMN window_group_id TEXT;
ALTER TABLE device_schedules ADD COLUMN window_start_minute INTEGER;
ALTER TABLE device_schedules ADD COLUMN window_end_minute INTEGER;
ALTER TABLE device_schedules ADD COLUMN enforce_every_minute INTEGER;

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset ON rate_limit_hits (reset_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions (user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_device_schedules_due ON device_schedules (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_device_schedules_window_group ON device_schedules (window_group_id);
CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule_id ON schedule_runs (schedule_id, planned_at);
CREATE INDEX IF NOT EXISTS idx_command_logs_device ON command_logs (device_id, id DESC);

-- Default admin credentials for local MVP:
-- email: admin@example.com
-- password: admin12345
INSERT OR IGNORE INTO users (email, password_hash, created_at)
VALUES (
  'admin@example.com',
  '$2b$12$pE5REBOZ19Ad.9CSB13J1O/n7nID3CKOq5dWd.XLOVlAHFLHEKTX.',
  datetime('now')
);

INSERT OR IGNORE INTO devices (device_id, name, location, hmac_secret, created_at)
VALUES (
  'lampu-ruang-tamu',
  'Lampu Ruang Tamu',
  'Ruang Tamu',
  'f43a301812844e47ab5908ebae902934fd3555cdc53f0da63df6fcb8a35bf98f',
  datetime('now')
);

INSERT OR IGNORE INTO user_devices (user_id, device_id, role, created_at)
SELECT u.id, d.id, 'owner', datetime('now')
FROM users u
JOIN devices d ON d.device_id = 'lampu-ruang-tamu'
WHERE u.email = 'admin@example.com';

-- Demo API key plaintext (for local testing only): demo-integration-key
INSERT OR IGNORE INTO integration_clients (name, api_key_hash, scopes, is_active, created_at)
VALUES (
  'demo-client',
  '10f752b000d239490916cb969f1a709cd4e3b359f51467adbaf20818cdcb3bfd',
  'read,command,schedule',
  1,
  datetime('now')
);

-- Upgrade legacy seeded admin SHA-256 hash to bcrypt.
UPDATE users
SET password_hash = '$2b$12$pE5REBOZ19Ad.9CSB13J1O/n7nID3CKOq5dWd.XLOVlAHFLHEKTX.'
WHERE email = 'admin@example.com'
  AND password_hash = '41e5653fc7aeb894026d6bb7b2db7f65902b454945fa8fd65a6327047b5277fb';

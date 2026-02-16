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

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
ON auth_sessions (user_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
ON auth_sessions (expires_at);

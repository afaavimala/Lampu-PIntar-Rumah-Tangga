CREATE TABLE IF NOT EXISTS rate_limit_hits (
  rate_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset ON rate_limit_hits (reset_at);

-- Upgrade legacy seeded admin SHA-256 hash to bcrypt.
UPDATE users
SET password_hash = '$2b$12$pE5REBOZ19Ad.9CSB13J1O/n7nID3CKOq5dWd.XLOVlAHFLHEKTX.'
WHERE email = 'admin@example.com'
  AND password_hash = '41e5653fc7aeb894026d6bb7b2db7f65902b454945fa8fd65a6327047b5277fb';

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

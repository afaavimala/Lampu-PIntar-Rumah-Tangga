ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN updated_at TEXT;

ALTER TABLE user_devices ADD COLUMN device_permission TEXT NOT NULL DEFAULT 'monitoring';
ALTER TABLE user_devices ADD COLUMN schedule_permission TEXT NOT NULL DEFAULT 'none';
ALTER TABLE user_devices ADD COLUMN assigned_by_user_id INTEGER;
ALTER TABLE user_devices ADD COLUMN updated_at TEXT;

ALTER TABLE device_schedules ADD COLUMN created_by_user_id INTEGER;

UPDATE users
SET role = COALESCE(NULLIF(TRIM(role), ''), 'member'),
    is_active = COALESCE(is_active, 1),
    updated_at = COALESCE(updated_at, created_at, datetime('now'));

UPDATE user_devices
SET device_permission = CASE
      WHEN role = 'owner' THEN 'manage'
      WHEN device_permission IN ('monitoring', 'control', 'manage') THEN device_permission
      ELSE 'monitoring'
    END,
    schedule_permission = CASE
      WHEN role = 'owner' THEN 'manage'
      WHEN schedule_permission IN ('none', 'monitoring', 'manage') THEN schedule_permission
      ELSE 'none'
    END,
    updated_at = COALESCE(updated_at, created_at, datetime('now'));

UPDATE device_schedules
SET created_by_user_id = COALESCE(created_by_user_id, user_id);

UPDATE users
SET role = 'admin',
    is_active = 1,
    updated_at = datetime('now')
WHERE email = 'admin@example.com';

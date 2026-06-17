ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT '';

UPDATE users
SET name = CASE
      WHEN LOWER(email) = LOWER('admin@example.com') THEN 'Administrator'
      ELSE COALESCE(NULLIF(TRIM(name), ''), SUBSTRING_INDEX(email, '@', 1))
    END,
    updated_at = COALESCE(updated_at, created_at, UTC_TIMESTAMP())
WHERE name IS NULL OR TRIM(name) = '';

UPDATE users
SET name = CASE
      WHEN lower(email) = lower('admin@example.com') THEN 'Administrator'
      ELSE COALESCE(NULLIF(TRIM(name), ''), substr(email, 1, instr(email, '@') - 1))
    END,
    updated_at = COALESCE(updated_at, created_at, datetime('now'))
WHERE name IS NULL OR TRIM(name) = '';

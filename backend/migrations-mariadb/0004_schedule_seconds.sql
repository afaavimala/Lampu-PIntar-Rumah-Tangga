-- Schedule window values keep their legacy column names for API compatibility,
-- but are now stored as seconds-of-day and interval seconds.
UPDATE device_schedules
SET window_start_minute = window_start_minute * 60,
    window_end_minute = window_end_minute * 60,
    enforce_every_minute = enforce_every_minute * 60,
    cron_expr = CASE
      WHEN cron_expr LIKE '* * * * %' THEN CONCAT('* ', cron_expr)
      ELSE cron_expr
    END,
    updated_at = UTC_TIMESTAMP()
WHERE window_group_id IS NOT NULL
  AND window_start_minute IS NOT NULL
  AND window_end_minute IS NOT NULL
  AND enforce_every_minute IS NOT NULL;

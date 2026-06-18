-- Soft-delete compatibility is handled by migrate-remote preflight and runtime
-- schema compatibility. Fresh databases already include these columns in 0001.
SELECT 1;

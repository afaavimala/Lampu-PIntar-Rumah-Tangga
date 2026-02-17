CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255) NULL,
  hmac_secret VARCHAR(255) NULL,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_devices (
  user_id BIGINT UNSIGNED NOT NULL,
  device_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'owner',
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT fk_user_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_devices_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS command_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  device_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(16) NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  result VARCHAR(64) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_command_logs_device (device_id, id DESC),
  CONSTRAINT fk_command_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_command_logs_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_clients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  api_key_hash CHAR(64) NOT NULL,
  scopes TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_integration_clients_api_key_hash (api_key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(255) NOT NULL,
  route VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_body LONGTEXT NOT NULL,
  status_code INT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency_key (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  device_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(16) NOT NULL,
  cron_expr VARCHAR(128) NOT NULL,
  timezone VARCHAR(128) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  next_run_at BIGINT NOT NULL,
  last_run_at BIGINT NULL,
  start_at BIGINT NULL,
  end_at BIGINT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_device_schedules_due (enabled, next_run_at),
  CONSTRAINT fk_device_schedules_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_device_schedules_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedule_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  schedule_id BIGINT UNSIGNED NOT NULL,
  device_id BIGINT UNSIGNED NOT NULL,
  planned_at BIGINT NOT NULL,
  executed_at BIGINT NULL,
  request_id VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL,
  error_message TEXT NULL,
  created_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_schedule_runs_schedule_planned (schedule_id, planned_at),
  KEY idx_schedule_runs_schedule_id (schedule_id, planned_at),
  CONSTRAINT fk_schedule_runs_schedule FOREIGN KEY (schedule_id) REFERENCES device_schedules(id) ON DELETE CASCADE,
  CONSTRAINT fk_schedule_runs_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  rate_key VARCHAR(255) NOT NULL,
  request_count INT NOT NULL,
  reset_at BIGINT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (rate_key),
  KEY idx_rate_limit_hits_reset (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  last_used_at BIGINT NULL,
  rotated_at BIGINT NULL,
  revoked_at BIGINT NULL,
  replaced_by_session_id BIGINT UNSIGNED NULL,
  user_agent TEXT NULL,
  ip_address VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_sessions_refresh_hash (refresh_token_hash),
  KEY idx_auth_sessions_user_active (user_id, revoked_at, expires_at),
  KEY idx_auth_sessions_expires (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_auth_sessions_replacement FOREIGN KEY (replaced_by_session_id) REFERENCES auth_sessions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

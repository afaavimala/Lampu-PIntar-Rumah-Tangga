#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mariadb from 'mariadb'
import bcrypt from 'bcryptjs'

function readRequired(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function readNumber(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function quoteIdentifier(value) {
  return `\`${value.replaceAll('`', '``')}\``
}

async function ensureDatabase(config) {
  const bootstrapPool = mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectionLimit: 2,
  })

  try {
    const conn = await bootstrapPool.getConnection()
    try {
      const escapedDbName = quoteIdentifier(config.database)
      await conn.query(
        `CREATE DATABASE IF NOT EXISTS ${escapedDbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      )
    } finally {
      conn.release()
    }
  } finally {
    await bootstrapPool.end()
  }
}

async function ensureMigrationTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(191) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
}

async function readMigrationFiles() {
  const dir = resolve(process.cwd(), 'migrations-mariadb')
  const files = await readdir(dir)
  return files
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      version: name,
      path: resolve(dir, name),
    }))
}

async function applyMigrations(conn) {
  await ensureMigrationTable(conn)

  const existingRows = await conn.query('SELECT version FROM schema_migrations')
  const applied = new Set(existingRows.map((row) => String(row.version)))
  const migrations = await readMigrationFiles()

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      console.log(`[migrate] Skip ${migration.version}`)
      continue
    }

    const sql = await readFile(migration.path, 'utf-8')
    console.log(`[migrate] Applying ${migration.version}`)

    await conn.beginTransaction()
    try {
      await conn.query(sql)
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version])
      await conn.commit()
      console.log(`[migrate] Applied ${migration.version}`)
    } catch (error) {
      await conn.rollback()
      throw error
    }
  }
}

async function hasColumn(conn, tableName, columnName) {
  const rows = await conn.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName],
  )
  return rows.length > 0
}

async function ensureColumn(conn, tableName, columnName, definitionSql) {
  if (await hasColumn(conn, tableName, columnName)) {
    return
  }

  const escapedTable = quoteIdentifier(tableName)
  const escapedColumn = quoteIdentifier(columnName)
  await conn.query(`ALTER TABLE ${escapedTable} ADD COLUMN ${escapedColumn} ${definitionSql}`)
  console.log(`[migrate] Added ${tableName}.${columnName}`)
}

async function hasIndex(conn, tableName, indexName) {
  const rows = await conn.query(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1`,
    [tableName, indexName],
  )
  return rows.length > 0
}

async function ensureIndex(conn, tableName, indexName, indexExpressionSql) {
  if (await hasIndex(conn, tableName, indexName)) {
    return
  }

  const escapedTable = quoteIdentifier(tableName)
  const escapedIndex = quoteIdentifier(indexName)
  await conn.query(`CREATE INDEX ${escapedIndex} ON ${escapedTable} ${indexExpressionSql}`)
  console.log(`[migrate] Added index ${tableName}.${indexName}`)
}

async function ensureSchemaCompatibility(conn) {
  await ensureColumn(conn, 'device_schedules', 'window_group_id', 'VARCHAR(191) NULL')
  await ensureColumn(conn, 'device_schedules', 'window_start_minute', 'INT NULL')
  await ensureColumn(conn, 'device_schedules', 'window_end_minute', 'INT NULL')
  await ensureColumn(conn, 'device_schedules', 'enforce_every_minute', 'INT NULL')
  await ensureIndex(conn, 'device_schedules', 'idx_device_schedules_window_group', '(window_group_id)')
}

async function seedDefaults(conn) {
  const nowIso = new Date().toISOString()
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@example.com'
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || 'admin12345'
  const sampleDeviceId = process.env.SEED_SAMPLE_DEVICE_ID?.trim() || 'lampu-ruang-tamu'
  const sampleDeviceName = process.env.SEED_SAMPLE_DEVICE_NAME?.trim() || 'Lampu Ruang Tamu'
  const sampleDeviceLocation = process.env.SEED_SAMPLE_DEVICE_LOCATION?.trim() || 'Ruang Tamu'
  const legacySecretPlaceholder = 'unused-tasmota'
  const demoApiKey = process.env.SEED_DEMO_API_KEY?.trim() || 'demo-integration-key'
  const demoApiHash = createHash('sha256').update(demoApiKey).digest('hex')
  const passwordHash = await bcrypt.hash(adminPassword, 12)

  await conn.query(
    `INSERT INTO users (email, password_hash, created_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [adminEmail, passwordHash, nowIso],
  )

  await conn.query(
    `INSERT INTO devices (device_id, name, location, hmac_secret, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       location = VALUES(location),
       hmac_secret = VALUES(hmac_secret)`,
    [sampleDeviceId, sampleDeviceName, sampleDeviceLocation, legacySecretPlaceholder, nowIso],
  )

  const userRow = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [adminEmail])
  const deviceRow = await conn.query('SELECT id FROM devices WHERE device_id = ? LIMIT 1', [sampleDeviceId])
  const userId = Number(userRow[0]?.id ?? 0)
  const deviceId = Number(deviceRow[0]?.id ?? 0)

  if (!userId || !deviceId) {
    throw new Error('Failed to resolve seeded user/device IDs')
  }

  await conn.query(
    `INSERT IGNORE INTO user_devices (user_id, device_id, role, created_at)
     VALUES (?, ?, 'owner', ?)`,
    [userId, deviceId, nowIso],
  )

  await conn.query(
    `INSERT INTO integration_clients (name, api_key_hash, scopes, is_active, created_at)
     VALUES ('demo-client', ?, 'read,command,schedule', 1, ?)
     ON DUPLICATE KEY UPDATE
       scopes = VALUES(scopes),
       is_active = VALUES(is_active)`,
    [demoApiHash, nowIso],
  )

  console.log('[migrate] Seed ensured')
  console.log(`[migrate] Seed admin email: ${adminEmail}`)
  console.log(`[migrate] Seed sample device: ${sampleDeviceId}`)
}

async function main() {
  const config = {
    host: process.env.DB_HOST?.trim() || '127.0.0.1',
    port: readNumber('DB_PORT', 3306),
    user: readRequired('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: readRequired('DB_NAME'),
    connectionLimit: readNumber('DB_CONNECTION_LIMIT', 5),
  }

  await ensureDatabase(config)

  const pool = mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    multipleStatements: true,
    supportBigNumbers: true,
    bigIntAsNumber: true,
    dateStrings: true,
    timezone: 'Z',
  })

  try {
    const conn = await pool.getConnection()
    try {
      await applyMigrations(conn)
      await ensureSchemaCompatibility(conn)
      await seedDefaults(conn)
    } finally {
      conn.release()
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('[migrate] Failed', error)
  process.exit(1)
})

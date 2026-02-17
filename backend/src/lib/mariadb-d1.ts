import mariadb from 'mariadb'
import type { Pool } from 'mariadb'
import type { AppDatabase, DbAllResult, DbPreparedStatement, DbRunResult } from '../types/db'

export type MariaDbRuntimeConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
  connectionLimit: number
}

type MariaOkPacket = {
  affectedRows?: number
  insertId?: number
}

class MariaPreparedStatement implements DbPreparedStatement {
  constructor(
    private readonly pool: Pool,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new MariaPreparedStatement(this.pool, this.sql, params)
  }

  async first<T>(): Promise<T | null> {
    const result = await this.query()
    if (!Array.isArray(result) || result.length === 0) {
      return null
    }
    return result[0] as T
  }

  async all<T>(): Promise<DbAllResult<T>> {
    const result = await this.query()
    if (!Array.isArray(result)) {
      return { results: [] }
    }
    return { results: result as T[] }
  }

  async run(): Promise<DbRunResult> {
    const result = await this.query()
    if (Array.isArray(result)) {
      return {
        meta: {
          changes: 0,
          last_row_id: 0,
        },
      }
    }

    const packet = result as MariaOkPacket
    return {
      meta: {
        changes: Number(packet.affectedRows ?? 0),
        last_row_id: Number(packet.insertId ?? 0),
      },
    }
  }

  private async query() {
    const conn = await this.pool.getConnection()
    try {
      return await conn.query(this.sql, this.params)
    } finally {
      conn.release()
    }
  }
}

class MariaDatabase implements AppDatabase {
  readonly dialect = 'mariadb' as const

  constructor(private readonly pool: Pool) {}

  prepare(sql: string): DbPreparedStatement {
    return new MariaPreparedStatement(this.pool, sql)
  }
}

export function createMariaPool(config: MariaDbRuntimeConfig) {
  return mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    supportBigNumbers: true,
    bigIntAsNumber: true,
    dateStrings: true,
    timezone: 'Z',
  })
}

export function createMariaDatabase(pool: Pool): AppDatabase {
  return new MariaDatabase(pool)
}

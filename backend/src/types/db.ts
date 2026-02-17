export type DbQueryMeta = {
  changes: number
  last_row_id: number
}

export type DbRunResult = {
  meta: DbQueryMeta
}

export type DbAllResult<T> = {
  results: T[]
}

export interface DbPreparedStatement {
  bind(...params: unknown[]): DbPreparedStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<DbAllResult<T>>
  run(): Promise<DbRunResult>
}

export interface AppDatabase {
  dialect?: 'sqlite' | 'mariadb'
  prepare(sql: string): DbPreparedStatement
}

import type { AppDatabase } from './db'

declare global {
  type D1Database = AppDatabase
}

export {}

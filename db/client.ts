import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

// The ONLY place that differs between local dev and production: locally TURSO_URL points at a
// file:// path (db/local.db), in prod it points at the Turso libSQL URL. Same driver, same SQL
// dialect, no dual-binding divergence risk — see plan section "Decisions".
function resolveUrl(): string {
  return process.env.TURSO_URL || 'file:./db/local.db'
}

const client = createClient({
  url: resolveUrl(),
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export const db = drizzle(client, { schema })
export type Database = typeof db

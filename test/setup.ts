import fs from 'node:fs'
import path from 'node:path'
// A dedicated, file-based test database — never the dev DB. File-based (not ':memory:') because
// each `createClient({ url: ':memory:' })` call opens an independent, unshared in-memory
// database; db/client.ts opens its own connection later when dayType.ts imports it, so the
// migration applied here must land on a real file both connections can reopen.
const TEST_DB_PATH = path.resolve(__dirname, '../db/test.db')

process.env.TURSO_URL = `file:${TEST_DB_PATH}`
process.env.TURSO_AUTH_TOKEN = ''

for (const suffix of ['', '-shm', '-wal']) {
  const p = TEST_DB_PATH + suffix
  if (fs.existsSync(p)) fs.rmSync(p)
}

const { createClient } = await import('@libsql/client')
const { drizzle } = await import('drizzle-orm/libsql')
const { migrate } = await import('drizzle-orm/libsql/migrator')

const migrationClient = createClient({ url: process.env.TURSO_URL })
await migrate(drizzle(migrationClient), { migrationsFolder: path.resolve(__dirname, '../db/migrations') })
migrationClient.close()

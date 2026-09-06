import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.TURSO_URL || 'file:./db/local.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})

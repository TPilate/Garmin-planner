import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors Nuxt/Nitro's own '~~' root alias so server code needs no special-casing to be
      // unit-testable under plain vitest (no Nitro auto-import transform is available here).
      '~~': path.resolve(__dirname),
    },
  },
  test: {
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
  },
})

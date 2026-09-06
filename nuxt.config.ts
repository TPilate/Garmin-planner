// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@vite-pwa/nuxt', 'nuxt-auth-utils'],

  runtimeConfig: {
    tursoUrl: process.env.TURSO_URL,
    tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
    appPin: process.env.APP_PIN,
    ingestToken: process.env.INGEST_TOKEN,
    appTimezone: process.env.APP_TIMEZONE || 'Europe/Paris',
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Garmin Planner',
      short_name: 'Planner',
      description: 'Planificateur d’entraînement adapté aux gardes',
      theme_color: '#111827',
      background_color: '#111827',
      display: 'standalone',
      start_url: '/',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    workbox: {
      // Read-only offline caching only (per plan: server-authoritative, no offline writes).
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      runtimeCaching: [
        {
          urlPattern: /\/api\/(roster|day-summary)\/.*/,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'api-read-cache' },
        },
      ],
    },
    devOptions: {
      enabled: true,
      // Required to test the install-to-home-screen + push flow against a real iPhone
      // during the phase 0a spike (see scripts/spike-ios-push).
      type: 'module',
    },
  },
})

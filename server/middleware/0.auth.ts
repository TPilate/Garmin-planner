// Protects every /api/* route except the login/logout endpoints themselves and the internal
// Garmin ingest endpoint, which authenticates the Python worker via its own bearer token
// (see server/api/internal/garmin/ingest.post.ts, phase 3) instead of the user session cookie.
export default defineEventHandler(async (event) => {
  const path = event.path || ''
  if (!path.startsWith('/api/')) return
  if (path.startsWith('/api/auth/')) return
  if (path === '/api/internal/garmin/ingest') return

  const session = await getUserSession(event)
  if (!session.user?.loggedIn) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})

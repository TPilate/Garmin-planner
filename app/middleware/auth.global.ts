// Page-level guard, mirrors server/middleware/0.auth.ts for API routes. Runs on both SSR and
// client navigation since it's a global route middleware.
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/login') return

  const { loggedIn } = useUserSession()
  if (!loggedIn.value) {
    return navigateTo('/login')
  }
})

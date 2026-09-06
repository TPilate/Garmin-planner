import { z } from 'zod'

const bodySchema = z.object({ pin: z.string().min(1) })

// Single shared PIN, no user table — see plan "Decisions": the admin/developer already has
// unmediated DB/deploy access, so a second web identity would add a credential with no real
// security benefit at this scale.
export default defineEventHandler(async (event) => {
  const { pin } = await readValidatedBody(event, body => bodySchema.parse(body))
  const config = useRuntimeConfig(event)

  if (!config.appPin) {
    throw createError({ statusCode: 500, statusMessage: 'APP_PIN not configured' })
  }

  if (!timingSafeEqual(pin, config.appPin)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid PIN' })
  }

  await setUserSession(event, { user: { loggedIn: true } })
  return { ok: true }
})

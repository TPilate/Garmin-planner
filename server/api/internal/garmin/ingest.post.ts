import { z } from 'zod'
import { rawGarminPayloads } from '~~/db/schema'

const bodySchema = z.object({
  source: z.enum(['garth', 'official', 'terra']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metricType: z.enum(['sleep', 'hrv', 'resting_hr', 'body_battery', 'training_readiness', 'stress', 'activities']),
  rawPayload: z.unknown(),
})

// Authenticated by its own bearer token (INGEST_TOKEN), never the user session cookie — this is
// how the Python worker, which has no DB access of its own, writes Garmin data (see plan
// "Decisions": Python is schema-blind by construction). server/middleware/0.auth.ts excludes
// this exact path from the session check.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const authHeader = getHeader(event, 'authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')

  if (!config.ingestToken || !timingSafeEqual(token, config.ingestToken)) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { source, date, metricType, rawPayload } = await readValidatedBody(event, body => bodySchema.parse(body))

  // Append-only: never lose an earlier fetch if a Garmin-reported value shifts on a later pull.
  await db.insert(rawGarminPayloads).values({
    source,
    date,
    metricType,
    rawJson: JSON.stringify(rawPayload),
    fetchedAt: new Date(),
  })

  await normalizeGarminPayload(source, date, metricType, rawPayload)

  return { ok: true }
})

import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { loggedSessions } from '~~/db/schema'

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['completed', 'skipped']),
  actualRpe: z.number().int().min(1).max(10).nullable().optional(),
  actualDurationMinutes: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
})

// Requires a planned row to already exist (or creates one on the fly) — logging always acts on
// the SAME row the day's prescription created, per design doc "Modèle de données".
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => bodySchema.parse(body))
  const config = useRuntimeConfig(event)

  const loggedSessionId = await ensurePlannedSession(input.date, config.appTimezone)
  if (loggedSessionId === null) {
    throw createError({ statusCode: 422, statusMessage: 'No session was prescribed for this date' })
  }

  await db.update(loggedSessions)
    .set({
      status: input.status,
      actualRpe: input.actualRpe,
      actualDurationMinutes: input.actualDurationMinutes,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(loggedSessions.id, loggedSessionId))

  return { ok: true }
})

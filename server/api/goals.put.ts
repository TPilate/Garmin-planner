import { z } from 'zod'
import { disciplineGoals } from '~~/db/schema'

const bodySchema = z.object({
  discipline: z.enum(['running', 'swimming', 'strength', 'cycling']),
  active: z.boolean(),
  weeklyFrequencyTarget: z.number().int().positive(),
  blockLengthWeeks: z.number().int().positive(),
  planStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  baselineJson: z.string().nullable().optional(),
})

// Upsert a single discipline goal — same pattern as server/api/shift-codes.put.ts.
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => bodySchema.parse(body))

  await db
    .insert(disciplineGoals)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: disciplineGoals.discipline,
      set: { ...input, updatedAt: new Date() },
    })

  return { ok: true }
})

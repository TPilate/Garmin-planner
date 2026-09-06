import { z } from 'zod'
import { shiftCodes } from '~~/db/schema'

const bodySchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  crossesMidnight: z.boolean(),
  durationMinutes: z.number().int().positive(),
  category: z.enum(['long_day', 'night', 'half_day']),
  active: z.boolean(),
})

// Upsert a single shift code — the admin screen calls this per row. `category` (not the literal
// `code`) is what server/utils/dayType.ts switches on, so editing/renaming codes here never
// requires touching derivation logic.
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => bodySchema.parse(body))

  await db
    .insert(shiftCodes)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: shiftCodes.code,
      set: { ...input, updatedAt: new Date() },
    })

  return { ok: true }
})

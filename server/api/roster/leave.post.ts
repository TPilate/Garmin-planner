import { z } from 'zod'
import { leavePeriods } from '~~/db/schema'

const bodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['vacation', 'sick', 'other']),
  note: z.string().optional(),
})

// Lets her tag a stretch of empty roster days as leave/vacation during review — distinguishes a
// taper opportunity or illness from a plain rest day, which the roster alone can't tell apart.
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => bodySchema.parse(body))

  if (input.endDate < input.startDate) {
    throw createError({ statusCode: 400, statusMessage: 'endDate must not be before startDate' })
  }

  const [inserted] = await db.insert(leavePeriods)
    .values(input)
    .returning()

  return inserted
})

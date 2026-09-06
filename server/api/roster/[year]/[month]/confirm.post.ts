import { and, count, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { rosterMonths, shifts } from '~~/db/schema'

const bodySchema = z.object({ override: z.boolean().optional().default(false) })

// A full-time midwife works roughly 18-22 days a month. If a month's worked-day count falls
// outside that range, an explicit override is required rather than silently accepting a
// possible missed-entry or fat-fingered month — see plan "Plausibility check before commit".
const PLAUSIBLE_MIN = 18
const PLAUSIBLE_MAX = 22

export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const { override } = await readValidatedBody(event, body => bodySchema.parse(body))

  const rosterMonth = await db.query.rosterMonths.findFirst({
    where: (t, { and, eq }) => and(eq(t.year, year), eq(t.month, month)),
  })
  if (!rosterMonth) {
    throw createError({ statusCode: 404, statusMessage: 'Roster month not found — save the grid before confirming' })
  }

  const { first, last } = firstAndLastOfMonth(year, month)
  const [{ workedDays }] = await db
    .select({ workedDays: count() })
    .from(shifts)
    .where(and(gte(shifts.date, first), lte(shifts.date, last)))

  const plausible = workedDays >= PLAUSIBLE_MIN && workedDays <= PLAUSIBLE_MAX

  if (!plausible && !override) {
    return {
      ok: false,
      requiresOverride: true,
      workedDays,
      expectedRange: [PLAUSIBLE_MIN, PLAUSIBLE_MAX],
    }
  }

  await db.update(rosterMonths)
    .set({ status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(rosterMonths.id, rosterMonth.id))

  return { ok: true, workedDays }
})

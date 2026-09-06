import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { rosterMonths, shiftCodes, shifts } from '~~/db/schema'

const bodySchema = z.object({
  assignments: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    code: z.string().nullable(),
  })),
})

export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const { assignments } = await readValidatedBody(event, body => bodySchema.parse(body))
  const config = useRuntimeConfig(event)

  const activeCodes = await db.select().from(shiftCodes).where(eq(shiftCodes.active, true))
  const codeByCode = new Map(activeCodes.map(c => [c.code, c]))

  let rosterMonth = await db.query.rosterMonths.findFirst({
    where: (t, { and, eq }) => and(eq(t.year, year), eq(t.month, month)),
  })

  if (!rosterMonth) {
    const [inserted] = await db.insert(rosterMonths).values({ year, month, status: 'draft', source: 'manual' }).returning()
    rosterMonth = inserted
  }
  else if (rosterMonth.status !== 'draft') {
    // Editing a confirmed month must force it back through the plausibility check before the
    // scheduler trusts it again — silently keeping 'confirmed' would let an edited-but-unreviewed
    // month look identical to a reviewed one.
    await db.update(rosterMonths)
      .set({ status: 'draft', confirmedAt: null, updatedAt: new Date() })
      .where(eq(rosterMonths.id, rosterMonth.id))
  }

  for (const assignment of assignments) {
    if (assignment.code === null) {
      // Rest is derived from absence — never store a rest row, only remove any previously
      // saved worked shift for this date.
      await db.delete(shifts).where(eq(shifts.date, assignment.date))
      continue
    }

    const shiftCode = codeByCode.get(assignment.code)
    if (!shiftCode) {
      throw createError({ statusCode: 400, statusMessage: `Unknown or inactive shift code: ${assignment.code}` })
    }

    const { startsAt, endsAt } = resolveShiftTimes(assignment.date, shiftCode, config.appTimezone)

    await db.insert(shifts)
      .values({
        date: assignment.date,
        code: assignment.code,
        startsAt,
        endsAt,
        source: 'manual',
        rosterMonthId: rosterMonth.id,
      })
      .onConflictDoUpdate({
        target: shifts.date,
        set: {
          code: assignment.code,
          startsAt,
          endsAt,
          source: 'manual',
          rosterMonthId: rosterMonth.id,
          updatedAt: new Date(),
        },
      })
  }

  return { ok: true, status: 'draft' }
})

import { and, eq, gte, lte } from 'drizzle-orm'
import { leavePeriods, rosterMonths, shifts } from '~~/db/schema'

export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const { first, last } = firstAndLastOfMonth(year, month)

  const [rosterMonth, monthShifts, monthLeave] = await Promise.all([
    db.query.rosterMonths.findFirst({ where: and(eq(rosterMonths.year, year), eq(rosterMonths.month, month)) }),
    db.select().from(shifts).where(and(gte(shifts.date, first), lte(shifts.date, last))),
    // Overlap test: a leave period overlaps this month if it starts before the month ends
    // AND ends after the month starts.
    db.select().from(leavePeriods).where(and(lte(leavePeriods.startDate, last), gte(leavePeriods.endDate, first))),
  ])

  const shiftsByDate = new Map(monthShifts.map(s => [s.date, s]))
  const skeleton = generateMonthSkeleton(year, month)

  const days = skeleton.map(({ date, day }) => ({
    date,
    day,
    code: shiftsByDate.get(date)?.code ?? null,
    isLeave: monthLeave.some(l => date >= l.startDate && date <= l.endDate),
  }))

  return {
    year,
    month,
    status: rosterMonth?.status ?? 'draft',
    confirmedAt: rosterMonth?.confirmedAt ?? null,
    days,
  }
})

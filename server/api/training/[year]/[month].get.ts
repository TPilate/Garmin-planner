import { eq } from 'drizzle-orm'
import { loggedSessions, sessionTemplates } from '~~/db/schema'

// One entry per calendar day of the month, generating (and persisting, via ensurePlannedSession)
// a prescription for any day that doesn't have one yet. Mirrors day-summary/[year]/[month].get.ts.
export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const config = useRuntimeConfig(event)
  const skeleton = generateMonthSkeleton(year, month)

  const days = await Promise.all(skeleton.map(async ({ date }) => {
    const loggedSessionId = await ensurePlannedSession(date, config.appTimezone)
    if (loggedSessionId === null) {
      const prescription = await getDailyPrescription(date, config.appTimezone)
      return { date, hasSession: false, reason: prescription.reason }
    }

    const row = await db
      .select({
        status: loggedSessions.status,
        actualRpe: loggedSessions.actualRpe,
        actualDurationMinutes: loggedSessions.actualDurationMinutes,
        notes: loggedSessions.notes,
        sessionName: sessionTemplates.name,
        discipline: sessionTemplates.discipline,
        targetIntensity: sessionTemplates.targetIntensity,
        durationMinutes: sessionTemplates.durationMinutes,
        structureJson: sessionTemplates.structureJson,
      })
      .from(loggedSessions)
      .innerJoin(sessionTemplates, eq(loggedSessions.sessionTemplateId, sessionTemplates.id))
      .where(eq(loggedSessions.id, loggedSessionId))
      .then(rows => rows[0])

    return { date, hasSession: true, ...row }
  }))

  return { year, month, days }
})

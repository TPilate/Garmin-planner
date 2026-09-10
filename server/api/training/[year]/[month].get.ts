import { eq } from 'drizzle-orm'
import { loggedSessions, sessionTemplates } from '~~/db/schema'

// One entry per calendar day of the month, generating (and persisting, via ensurePlannedSession)
// a prescription for any day that doesn't have one yet. Mirrors day-summary/[year]/[month].get.ts.
export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const config = useRuntimeConfig(event)
  const skeleton = generateMonthSkeleton(year, month)

  // Sequential, not Promise.all: ensurePlannedSession has a write side effect (it reads
  // logged_sessions for "recently used templates" then inserts a new row), and its variety
  // logic depends on each day's read seeing the PRIOR day's write already committed. Running
  // the whole month concurrently would race every day's read ahead of its siblings' writes and
  // collapse them all onto the same lowest-id template per discipline.
  const days = []
  for (const { date } of skeleton) {
    const loggedSessionId = await ensurePlannedSession(date, config.appTimezone)
    if (loggedSessionId === null) {
      const prescription = await getDailyPrescription(date, config.appTimezone)
      days.push({ date, hasSession: false, reason: prescription.reason })
      continue
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

    days.push({ date, hasSession: true, ...row })
  }

  return { year, month, days }
})

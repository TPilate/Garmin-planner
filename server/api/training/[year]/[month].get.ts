import { eq } from 'drizzle-orm'
import { loggedSessions, sessionTemplates } from '~~/db/schema'

// One entry per calendar day of the month. NEVER persists anything — a day with an existing
// logged_sessions row (real history: logged, or planned by a PRIOR call to POST /api/training/log)
// is read back verbatim; every other day gets a freshly-computed, non-persisted prescription for
// display only. This is deliberate: see docs/superpowers/specs/.../design.md "jamais pré-généré en
// masse" — bulk-persisting a month's worth of `planned` rows on first view collapses
// getDisciplineProgress()'s weekly-deficit ranking (which only counts status='completed') onto a
// single discipline for the whole week, and then never re-derives once the roster changes
// underneath it. logged_sessions rows are created in exactly one place: ensurePlannedSession(),
// called from POST /api/training/log at the moment the user actually logs a session.
export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const config = useRuntimeConfig(event)
  const skeleton = generateMonthSkeleton(year, month)

  // Promise.all is safe here: every branch is a pure read (existing-row lookup, or a
  // non-persisted getDailyPrescription() call) — no write side effect, so no ordering
  // dependency between sibling days.
  const days = await Promise.all(skeleton.map(async ({ date }) => {
    const existing = await db.query.loggedSessions.findFirst({ where: eq(loggedSessions.date, date) })
    if (existing) {
      const template = existing.sessionTemplateId
        ? await db.query.sessionTemplates.findFirst({ where: eq(sessionTemplates.id, existing.sessionTemplateId) })
        : null
      return {
        date,
        hasSession: true,
        discipline: template?.discipline,
        sessionName: template?.name,
        targetIntensity: template?.targetIntensity,
        durationMinutes: template?.durationMinutes,
        structureJson: template?.structureJson,
        status: existing.status,
        actualRpe: existing.actualRpe,
        actualDurationMinutes: existing.actualDurationMinutes,
        notes: existing.notes,
      }
    }

    // No row yet: compute a fresh, NON-PERSISTED prescription for display only.
    const prescription = await getDailyPrescription(date, config.appTimezone)
    if (!prescription.hasSession) {
      return { date, hasSession: false, reason: prescription.reason }
    }
    const template = await db.query.sessionTemplates.findFirst({ where: eq(sessionTemplates.id, prescription.sessionTemplateId!) })
    return {
      date,
      hasSession: true,
      discipline: prescription.discipline,
      sessionName: template?.name,
      targetIntensity: template?.targetIntensity,
      durationMinutes: template?.durationMinutes,
      structureJson: template?.structureJson,
      status: 'planned' as const, // virtual — not written to the DB
    }
  }))

  return { year, month, days }
})

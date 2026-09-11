import { eq } from 'drizzle-orm'
import { disciplineGoals, loggedSessions, sessionTemplates, shiftCodes, shifts } from '~~/db/schema'
import type { Discipline } from '../../utils/trainingPlan'

// Single-day aggregate for the "Aujourd'hui" home screen: day summary (ceiling + raw Garmin +
// baseline, for the rationale/edge-case displays), the shift worked that day (for the header),
// the free-time window, and the session (existing row read back verbatim, never persisted here —
// same rule as GET /api/training/[year]/[month]) plus that session's discipline's periodization
// position (for the "SEMAINE 2/4 · CHARGE" badge).
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid date' })
  }

  const config = useRuntimeConfig(event)
  const timezone = config.appTimezone

  const [daySummary, window, shift, lastGarminSyncAt] = await Promise.all([
    getDaySummary(date, timezone),
    getAvailableWindow(date, timezone),
    db.query.shifts.findFirst({ where: eq(shifts.date, date) }),
    getLastGarminSyncAt(),
  ])

  const shiftCode = shift ? await db.query.shiftCodes.findFirst({ where: eq(shiftCodes.code, shift.code) }) : null

  const existing = await db.query.loggedSessions.findFirst({ where: eq(loggedSessions.date, date) })

  let session: {
    hasSession: boolean
    discipline?: string
    sessionName?: string
    targetIntensity?: string
    durationMinutes?: number
    structureJson?: string | null
    status?: string
    sessionReason?: string
    actualRpe?: number | null
    actualDurationMinutes?: number | null
    notes?: string | null
  }

  if (existing) {
    const template = existing.sessionTemplateId
      ? await db.query.sessionTemplates.findFirst({ where: eq(sessionTemplates.id, existing.sessionTemplateId) })
      : null
    session = {
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
  else {
    const prescription = await getDailyPrescription(date, timezone)
    if (!prescription.hasSession) {
      session = { hasSession: false, sessionReason: prescription.reason }
    }
    else {
      const template = await db.query.sessionTemplates.findFirst({ where: eq(sessionTemplates.id, prescription.sessionTemplateId!) })
      session = {
        hasSession: true,
        discipline: prescription.discipline,
        sessionName: template?.name,
        targetIntensity: template?.targetIntensity,
        durationMinutes: template?.durationMinutes,
        structureJson: template?.structureJson,
        status: 'planned',
      }
    }
  }

  let progress: {
    blockNumber: number
    weekInBlock: number
    blockLengthWeeks: number
    phase: string
    completedThisWeek: number
    weeklyFrequencyTarget: number
    deficit: number
  } | null = null

  if (session.discipline) {
    const [disciplineProgress, goal] = await Promise.all([
      getDisciplineProgress(session.discipline as Discipline, date),
      db.query.disciplineGoals.findFirst({ where: eq(disciplineGoals.discipline, session.discipline as Discipline) }),
    ])
    if (disciplineProgress && goal) {
      progress = {
        blockNumber: disciplineProgress.blockNumber,
        weekInBlock: disciplineProgress.weekInBlock,
        blockLengthWeeks: goal.blockLengthWeeks,
        phase: disciplineProgress.phase,
        completedThisWeek: disciplineProgress.completedThisWeek,
        weeklyFrequencyTarget: disciplineProgress.weeklyFrequencyTarget,
        deficit: disciplineProgress.deficit,
      }
    }
  }

  return {
    date,
    dayType: daySummary.dayType,
    intensityCeiling: daySummary.intensityCeiling,
    metricsDegraded: daySummary.metricsDegraded,
    garminUsed: daySummary.garminUsed,
    reason: daySummary.reason,
    garminRestingHr: daySummary.garminRestingHr ?? null,
    garminHrvLastNight: daySummary.garminHrvLastNight ?? null,
    baselineRestingHr: daySummary.baselineRestingHr ?? null,
    baselineHrv: daySummary.baselineHrv ?? null,
    lastGarminSyncAt,
    shift: shift
      ? { code: shift.code, label: shiftCode?.label ?? shift.code, startsAt: shift.startsAt, endsAt: shift.endsAt }
      : null,
    minutesAvailable: window.minutesAvailable,
    ...session,
    progress,
  }
})

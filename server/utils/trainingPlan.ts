import { and, eq, gte, lt, lte, or } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '~~/db/client'
import { disciplineGoals, loggedSessions, sessionTemplates, shifts } from '~~/db/schema'
import { getDaySummary, INTENSITY_ORDER, type IntensityLevel } from './dayType'

// No shift row this day (off/leave) -> a generous but bounded default, so a full rest day never
// suggests an unrealistically long single session. Deliberately raw (see design doc): this does
// NOT model reasonable wake/sleep hours, so a shift starting at 07:00 reports up to 420 "free"
// minutes before it even though most of that is sleep time. The day's intensity ceiling (already
// capped for long_day/pre_night by dayType.ts) is what actually keeps prescriptions sane on
// those days — revisit if this produces bad suggestions in practice.
export const NO_SHIFT_MINUTES = 240

export interface AvailableWindow {
  minutesAvailable: number
  reason: string
}

// Computed straight from shifts.startsAt/endsAt, independent of the day's intensity ceiling.
// A post_night day's ceiling is already 'rest' (dayType.ts), and getDailyPrescription() never
// calls this for a 'rest' day — so this function never needs to reason about a PREVIOUS day's
// night shift bleeding into today.
export async function getAvailableWindow(date: string, timezone: string): Promise<AvailableWindow> {
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.date, date) })
  if (!shift) {
    return { minutesAvailable: NO_SHIFT_MINUTES, reason: 'no shift this day' }
  }

  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf('day')
  const dayEnd = dayStart.plus({ days: 1 })
  const startsAt = DateTime.fromJSDate(shift.startsAt, { zone: timezone })
  const endsAt = DateTime.fromJSDate(shift.endsAt, { zone: timezone })

  const beforeMinutes = Math.max(0, startsAt.diff(dayStart, 'minutes').minutes)
  const afterMinutes = Math.max(0, dayEnd.diff(endsAt, 'minutes').minutes)

  return beforeMinutes >= afterMinutes
    ? { minutesAvailable: beforeMinutes, reason: 'before shift' }
    : { minutesAvailable: afterMinutes, reason: 'after shift' }
}

export type Discipline = 'running' | 'swimming' | 'strength' | 'cycling'
export type PlanPhase = 'build' | 'deload'

export const DISCIPLINES: Discipline[] = ['running', 'swimming', 'strength', 'cycling']

export interface DisciplineProgress {
  discipline: Discipline
  blockNumber: number
  weekInBlock: number
  phase: PlanPhase
  completedThisWeek: number
  weeklyFrequencyTarget: number
  deficit: number
  lastSessionDate: string | null
}

function isoWeekStart(date: string): string {
  return DateTime.fromISO(date).startOf('week').toISODate()! // Monday, per luxon's default ISO week
}

// Recomputes the current block/week/phase from logged_sessions history every time it's called —
// never stores a mutable counter. Mirrors computeBaseline() in dayType.ts: a week only advances
// the block position if enough sessions were actually completed, so a rough month of shift work
// naturally holds the block instead of racing ahead of reality. See design doc "Approche retenue".
export async function getDisciplineProgress(discipline: Discipline, asOfDate: string): Promise<DisciplineProgress | null> {
  const goal = await db.query.disciplineGoals.findFirst({ where: eq(disciplineGoals.discipline, discipline) })
  if (!goal || !goal.active) return null

  const rows = await db
    .select({ date: loggedSessions.date, status: loggedSessions.status })
    .from(loggedSessions)
    .innerJoin(sessionTemplates, eq(loggedSessions.sessionTemplateId, sessionTemplates.id))
    .where(and(
      eq(sessionTemplates.discipline, discipline),
      gte(loggedSessions.date, goal.planStartDate),
      lte(loggedSessions.date, asOfDate),
    ))

  const completedByWeek = new Map<string, number>()
  let lastSessionDate: string | null = null
  for (const row of rows) {
    if (row.status !== 'completed') continue
    const key = isoWeekStart(row.date)
    completedByWeek.set(key, (completedByWeek.get(key) ?? 0) + 1)
    if (!lastSessionDate || row.date > lastSessionDate) lastSessionDate = row.date
  }

  const cycleLength = goal.blockLengthWeeks + 1 // + the deload week
  const completionThreshold = Math.max(0, goal.weeklyFrequencyTarget - 1) // tolerates one missed session

  let blockNumber = 1
  let weekInBlock = 1
  let cursor = DateTime.fromISO(goal.planStartDate).startOf('week')
  const targetWeek = DateTime.fromISO(asOfDate).startOf('week')

  while (cursor < targetWeek) {
    const completed = completedByWeek.get(cursor.toISODate()!) ?? 0
    if (completed >= completionThreshold) {
      if (weekInBlock === cycleLength) {
        weekInBlock = 1
        blockNumber += 1
      }
      else {
        weekInBlock += 1
      }
    }
    cursor = cursor.plus({ weeks: 1 })
  }

  const completedThisWeek = completedByWeek.get(targetWeek.toISODate()!) ?? 0

  return {
    discipline,
    blockNumber,
    weekInBlock,
    phase: weekInBlock === cycleLength ? 'deload' : 'build',
    completedThisWeek,
    weeklyFrequencyTarget: goal.weeklyFrequencyTarget,
    deficit: goal.weeklyFrequencyTarget - completedThisWeek,
    lastSessionDate,
  }
}

export interface Prescription {
  date: string
  hasSession: boolean
  discipline?: Discipline
  sessionTemplateId?: number
  reason?: string
}

// Avoids suggesting the exact same template on consecutive outings, but only if excluding
// recently-used templates still leaves a candidate — "avoid repetition" must never be the reason
// a day ends up with NO session.
const RECENT_VARIETY_DAYS = 14

async function getRecentlyUsedTemplateIds(date: string): Promise<Set<number>> {
  const cutoff = DateTime.fromISO(date).minus({ days: RECENT_VARIETY_DAYS }).toISODate()!
  const rows = await db.query.loggedSessions.findMany({
    where: and(gte(loggedSessions.date, cutoff), lt(loggedSessions.date, date)),
    columns: { sessionTemplateId: true },
  })
  return new Set(rows.map(r => r.sessionTemplateId).filter((id): id is number => id !== null))
}

async function pickTemplate(
  discipline: Discipline,
  ceiling: IntensityLevel,
  minutesAvailable: number,
  phase: PlanPhase,
  excludeIds: Set<number>,
): Promise<{ id: number } | null> {
  const maxIndex = INTENSITY_ORDER.indexOf(ceiling)
  const candidates = await db.query.sessionTemplates.findMany({
    where: and(
      eq(sessionTemplates.discipline, discipline),
      eq(sessionTemplates.isArchived, false),
      lte(sessionTemplates.durationMinutes, minutesAvailable),
      or(eq(sessionTemplates.phase, phase), eq(sessionTemplates.phase, 'any')),
    ),
  })
  const fitting = candidates.filter(t => INTENSITY_ORDER.indexOf(t.targetIntensity) <= maxIndex)
  if (fitting.length === 0) return null

  const fresh = fitting.filter(t => !excludeIds.has(t.id))
  const pool = fresh.length > 0 ? fresh : fitting
  // Smallest id wins among ties — deterministic, so re-reading an un-acted-on day always
  // returns the same proposal.
  return pool.reduce((min, t) => (t.id < min.id ? t : min))
}

export async function getDailyPrescription(date: string, timezone: string): Promise<Prescription> {
  const daySummary = await getDaySummary(date, timezone)
  if (daySummary.intensityCeiling === null || daySummary.intensityCeiling === 'rest') {
    return { date, hasSession: false, reason: daySummary.reason ?? `day type ${daySummary.dayType} allows no session` }
  }
  const ceiling = daySummary.intensityCeiling

  const window = await getAvailableWindow(date, timezone)

  const progresses: DisciplineProgress[] = []
  for (const discipline of DISCIPLINES) {
    const progress = await getDisciplineProgress(discipline, date)
    if (progress) progresses.push(progress)
  }

  const isoWeekday = DateTime.fromISO(date, { zone: timezone }).weekday // 1=Mon..7=Sun
  const daysLeftInWeek = 8 - isoWeekday // includes today

  const sentinel = '0000-00-00' // sorts before every real date -> "never trained" goes first
  const ranked = progresses
    .filter(p => p.deficit > 0)
    .sort((a, b) => {
      const urgencyDiff = (b.deficit / daysLeftInWeek) - (a.deficit / daysLeftInWeek)
      if (urgencyDiff !== 0) return urgencyDiff
      const aLast = a.lastSessionDate ?? sentinel
      const bLast = b.lastSessionDate ?? sentinel
      return aLast < bLast ? -1 : aLast > bLast ? 1 : 0
    })

  const excludeIds = await getRecentlyUsedTemplateIds(date)

  for (const progress of ranked) {
    const template = await pickTemplate(progress.discipline, ceiling, window.minutesAvailable, progress.phase, excludeIds)
    if (template) {
      return { date, hasSession: true, discipline: progress.discipline, sessionTemplateId: template.id }
    }
  }

  return { date, hasSession: false, reason: 'no discipline had a matching session template for this ceiling/window' }
}

// Idempotent: only writes when no logged_sessions row exists yet for this date. Never touches
// an existing row, whatever its status — see design doc "Cas limites".
export async function ensurePlannedSession(date: string, timezone: string): Promise<number | null> {
  const existing = await db.query.loggedSessions.findFirst({ where: eq(loggedSessions.date, date) })
  if (existing) return existing.id

  const prescription = await getDailyPrescription(date, timezone)
  if (!prescription.hasSession) return null

  const daySummary = await getDaySummary(date, timezone)
  const now = new Date()
  const [inserted] = await db.insert(loggedSessions).values({
    date,
    sessionTemplateId: prescription.sessionTemplateId!,
    plannedIntensityCeiling: daySummary.intensityCeiling,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: loggedSessions.date }).returning({ id: loggedSessions.id })

  if (inserted) return inserted.id
  // Another concurrent call won the race — re-read rather than assume failure.
  const row = await db.query.loggedSessions.findFirst({ where: eq(loggedSessions.date, date) })
  return row?.id ?? null
}

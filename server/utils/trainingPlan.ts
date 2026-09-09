import { and, eq, gte, lte } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '~~/db/client'
import { disciplineGoals, loggedSessions, sessionTemplates, shifts } from '~~/db/schema'

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

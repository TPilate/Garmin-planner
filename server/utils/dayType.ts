import { and, eq, gte, lte } from 'drizzle-orm'
import { db } from '~~/db/client'
import { garminDailyMetrics, leavePeriods, rosterMonths, shiftCodes, shifts } from '~~/db/schema'
// Explicit import (not relying on Nitro's server/utils auto-import) so this module also works
// unmodified under plain vitest, which has no Nitro auto-import transform.
import { calendarDateOf } from './shiftResolution'

export type DayType = 'off' | 'half' | 'pre_night' | 'long_day' | 'post_night' | 'leave' | 'no_data' | 'unknown'
export type IntensityLevel = 'rest' | 'mobility' | 'easy' | 'moderate' | 'hard'

export const INTENSITY_ORDER: IntensityLevel[] = ['rest', 'mobility', 'easy', 'moderate', 'hard']

// Garmin can never force full REST on a non-post-night day — floor is MOBILITY (index 1), to
// avoid a false-positive readiness dip silently blocking a legitimately free day. Since callers
// only ever pass notches <= 0, this also never pushes a day ABOVE its own base ceiling.
function clampIntensity(baseCeiling: IntensityLevel, notches: number): IntensityLevel {
  const index = INTENSITY_ORDER.indexOf(baseCeiling)
  const clamped = Math.max(1, index + notches)
  return INTENSITY_ORDER[clamped]
}

// Hard upper bound per day type. Garmin readiness (when not degraded) can only pull the ceiling
// DOWN within this bound, never push it above — a perfect readiness score on a LONG_DAY still
// caps at MOBILITY, because the constraint there is time/fatigue-from-shift, not recovery.
const CEILING_BY_DAY_TYPE: Record<DayType, IntensityLevel | null> = {
  off: 'hard',
  half: 'hard', // judgment call, see PROJECT_LOG risk #1 — brief gave only a relative rank
  pre_night: 'moderate',
  long_day: 'mobility',
  post_night: 'rest',
  leave: 'hard',
  no_data: null,
  unknown: 'rest', // unmapped shift_codes.category — fail safe
}

export interface DaySummary {
  date: string
  dayType: DayType
  metricsDegraded: boolean | null
  intensityCeiling: IntensityLevel | null
  garminUsed: boolean
  reason?: string
}

interface DayClassification {
  dayType: DayType
  metricsDegraded: boolean
  reason?: string
}

function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const prev = new Date(y, m - 1, d - 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
}

function finalize(
  date: string,
  dayType: DayType,
  metricsDegraded: boolean | null,
  intensityCeiling: IntensityLevel | null,
  garminUsed: boolean,
  reason?: string,
): DaySummary {
  return { date, dayType, metricsDegraded, intensityCeiling, garminUsed, reason }
}

async function findConfirmedRosterMonth(date: string) {
  const [year, month] = date.split('-').map(Number)
  return db.query.rosterMonths.findFirst({
    where: and(eq(rosterMonths.year, year), eq(rosterMonths.month, month)),
  })
}

// Roster/shift classification only — deliberately does NOT touch Garmin data or the baseline,
// so computeBaseline() can call this for every day in its window without any risk of recursing
// into another baseline computation (metricsDegraded is fully determined by shift data alone).
async function classifyDay(date: string, timezone: string): Promise<DayClassification | { dayType: 'no_data', metricsDegraded: null, reason: string }> {
  const prevDate = previousDate(date)
  const [rm, rmPrev] = await Promise.all([findConfirmedRosterMonth(date), findConfirmedRosterMonth(prevDate)])

  // GUARD 1: current month must be confirmed.
  if (!rm || rm.status !== 'confirmed') {
    return { dayType: 'no_data', metricsDegraded: null, reason: 'current month not confirmed' }
  }
  // GUARD 2: previous day's month must ALSO be confirmed — needed to rule out an unconfirmed
  // prevDate having been an N whose end lands on `date` (handles the cross-month boundary too).
  if (!rmPrev || rmPrev.status !== 'confirmed') {
    return { dayType: 'no_data', metricsDegraded: null, reason: 'previous day month not confirmed, cannot rule out post-night' }
  }

  const [todayShift, prevShift] = await Promise.all([
    db.query.shifts.findFirst({ where: eq(shifts.date, date) }),
    db.query.shifts.findFirst({ where: eq(shifts.date, prevDate) }),
  ])

  const todayCode = todayShift ? await db.query.shiftCodes.findFirst({ where: eq(shiftCodes.code, todayShift.code) }) : null
  const prevCode = prevShift ? await db.query.shiftCodes.findFirst({ where: eq(shiftCodes.code, prevShift.code) }) : null

  // A night shift consumes TWO calendar days — check both today's own shift AND whether
  // yesterday's shift was an N whose endsAt actually lands on `date`. This overrides everything
  // else, even a fresh N starting again tonight (back-to-back nights): post-night rest still
  // wins for the daytime hours of `date`.
  const wasPostNight = Boolean(
    prevCode?.category === 'night' && prevShift && calendarDateOf(prevShift.endsAt, timezone) === date,
  )
  if (wasPostNight) {
    return { dayType: 'post_night', metricsDegraded: true }
  }

  if (!todayCode) {
    const leave = await db.query.leavePeriods.findFirst({
      where: and(lte(leavePeriods.startDate, date), gte(leavePeriods.endDate, date)),
    })
    return { dayType: leave ? 'leave' : 'off', metricsDegraded: false }
  }
  if (todayCode.category === 'half_day') {
    return { dayType: 'half', metricsDegraded: false }
  }
  if (todayCode.category === 'night') {
    // Tonight's sleep will be fragmented/logged oddly by Garmin — degraded regardless of what
    // today's Garmin readiness score claims.
    return { dayType: 'pre_night', metricsDegraded: true }
  }
  if (todayCode.category === 'long_day') {
    return { dayType: 'long_day', metricsDegraded: false }
  }

  return { dayType: 'unknown', metricsDegraded: true, reason: `unmapped shift_codes.category: ${todayCode.category}` }
}

interface BaselineStats { median: number, p25: number, p75: number }

async function computeBaseline(
  asOfDate: string,
  timezone: string,
  windowDays = 28,
): Promise<{ restingHr: BaselineStats | null, hrv: BaselineStats | null }> {
  const [y, m, d] = asOfDate.split('-').map(Number)
  const start = new Date(y, m - 1, d - windowDays)
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`

  const rows = await db.query.garminDailyMetrics.findMany({
    where: (t, { and, gte, lt }) => and(gte(t.date, startDate), lt(t.date, asOfDate)),
  })

  const eligible: { restingHr: number | null, hrvLastNight: number | null }[] = []
  for (const row of rows) {
    // Exclude days that were themselves metrics-degraded — raw values survive shift work
    // better than Garmin's interpretations, but only once the genuinely corrupted days are
    // excluded too.
    const classification = await classifyDay(row.date, timezone)
    if (classification.metricsDegraded === false) {
      eligible.push({ restingHr: row.restingHr, hrvLastNight: row.hrvLastNight })
    }
  }

  function medianAndIqr(values: number[]): BaselineStats | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
    return { median: pct(0.5), p25: pct(0.25), p75: pct(0.75) }
  }

  return {
    restingHr: medianAndIqr(eligible.map(e => e.restingHr).filter((v): v is number => v != null)),
    hrv: medianAndIqr(eligible.map(e => e.hrvLastNight).filter((v): v is number => v != null)),
  }
}

// Never trusts trainingReadinessScore/sleepScore/hrvStatus/bodyBattery (Garmin's own
// nocturnal-sleep-assuming interpretations) — only restingHr and hrvLastNight, the raw values,
// which survive shift work better. 1 IQR deviation -> -1 notch; both metrics beyond 1.5 IQR ->
// -2 notches. First-pass heuristic, to be tuned after the phase 0b garth spike.
function compareToBaseline(
  garmin: { restingHr: number | null, hrvLastNight: number | null },
  baseline: { restingHr: BaselineStats | null, hrv: BaselineStats | null },
): number {
  let flags = 0
  let strongFlags = 0

  if (garmin.restingHr != null && baseline.restingHr) {
    const iqr = baseline.restingHr.p75 - baseline.restingHr.p25
    if (iqr > 0) {
      const deviation = (garmin.restingHr - baseline.restingHr.median) / iqr
      if (deviation > 1) flags++
      if (deviation > 1.5) strongFlags++
    }
  }
  if (garmin.hrvLastNight != null && baseline.hrv) {
    const iqr = baseline.hrv.p75 - baseline.hrv.p25
    if (iqr > 0) {
      const deviation = (baseline.hrv.median - garmin.hrvLastNight) / iqr // low HRV = bad
      if (deviation > 1) flags++
      if (deviation > 1.5) strongFlags++
    }
  }

  if (strongFlags >= 2) return -2
  if (flags >= 1) return -1
  return 0
}

// The single source of truth for "what can she do today". See PROJECT_LOG.md for the exact
// rule set this implements. Every branch here has a corresponding unit test in dayType.test.ts —
// this is the highest-risk-of-silent-bug file in the app: a missed cell and a rest day look
// identical, and a misread must never produce a hard session suggested on a 13h shift day.
export async function getDaySummary(date: string, timezone: string): Promise<DaySummary> {
  const classification = await classifyDay(date, timezone)

  if (classification.dayType === 'no_data') {
    return finalize(date, 'no_data', null, null, false, classification.reason)
  }

  const baseCeiling = CEILING_BY_DAY_TYPE[classification.dayType]!

  if (classification.metricsDegraded) {
    return finalize(date, classification.dayType, true, baseCeiling, false, classification.reason)
  }

  const garmin = await db.query.garminDailyMetrics.findFirst({ where: eq(garminDailyMetrics.date, date) })
  if (!garmin) {
    return finalize(date, classification.dayType, false, baseCeiling, false, 'no Garmin sync data for this date')
  }

  const baseline = await computeBaseline(date, timezone)
  const adjustment = compareToBaseline(garmin, baseline)
  const ceiling = adjustment === 0 ? baseCeiling : clampIntensity(baseCeiling, adjustment)

  return finalize(date, classification.dayType, false, ceiling, true)
}

import { eq } from 'drizzle-orm'
import { db } from '~~/db/client'
import { disciplineGoals, garminDailyMetrics, leavePeriods, loggedSessions, rosterMonths, sessionTemplates, shiftCodes, shifts } from '~~/db/schema'
import { resolveShiftTimes } from '../server/utils/shiftResolution'

export const TEST_TZ = 'Europe/Paris'

export async function resetTables() {
  await db.delete(loggedSessions)
  await db.delete(sessionTemplates)
  await db.delete(disciplineGoals)
  await db.delete(shifts)
  await db.delete(leavePeriods)
  await db.delete(garminDailyMetrics)
  await db.delete(rosterMonths)
  await db.delete(shiftCodes)
}

export async function seedShiftCodes() {
  await db.insert(shiftCodes).values([
    { code: 'J', label: 'Jour long', startTime: '07:00', endTime: '20:00', crossesMidnight: false, durationMinutes: 780, category: 'long_day' },
    { code: 'N', label: 'Nuit', startTime: '20:00', endTime: '08:00', crossesMidnight: true, durationMinutes: 720, category: 'night' },
    { code: '1/2', label: 'Demi-journée', startTime: '07:00', endTime: '14:00', crossesMidnight: false, durationMinutes: 420, category: 'half_day' },
  ])
}

export async function confirmMonth(year: number, month: number, status: 'confirmed' | 'draft' = 'confirmed') {
  const [row] = await db.insert(rosterMonths).values({ year, month, status, source: 'manual' }).returning()
  return row
}

export async function addShift(date: string, code: string, rosterMonthId: number) {
  const shiftCode = await db.query.shiftCodes.findFirst({ where: eq(shiftCodes.code, code) })
  if (!shiftCode) throw new Error(`Unknown shift code in test fixture: ${code}`)
  const { startsAt, endsAt } = resolveShiftTimes(date, shiftCode, TEST_TZ)
  await db.insert(shifts).values({ date, code, startsAt, endsAt, source: 'manual', rosterMonthId })
}

// Bypasses the category enum (which zod enforces only at the API layer, not the SQLite column
// itself) to exercise dayType.ts's UNKNOWN fail-safe for a category no admin screen should ever
// be able to produce through normal use.
export async function addShiftWithRawCategory(date: string, code: string, category: string, rosterMonthId: number) {
  await db.insert(shiftCodes).values({
    code,
    label: code,
    startTime: '09:00',
    endTime: '17:00',
    crossesMidnight: false,
    durationMinutes: 480,
    category: category as any,
  }).onConflictDoNothing()
  const { startsAt, endsAt } = resolveShiftTimes(date, { startTime: '09:00', endTime: '17:00', crossesMidnight: false }, TEST_TZ)
  await db.insert(shifts).values({ date, code, startsAt, endsAt, source: 'manual', rosterMonthId })
}

export async function addGarmin(date: string, restingHr: number | null, hrvLastNight: number | null) {
  await db.insert(garminDailyMetrics).values({ date, restingHr, hrvLastNight, source: 'garth', normalizedAt: new Date() })
}

export async function addLeave(startDate: string, endDate: string) {
  await db.insert(leavePeriods).values({ startDate, endDate, type: 'vacation' })
}

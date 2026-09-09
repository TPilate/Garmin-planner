import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '~~/db/client'
import { shifts } from '~~/db/schema'

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

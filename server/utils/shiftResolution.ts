import { DateTime } from 'luxon'

// Resolves a shift code's wall-clock template into absolute instants for one calendar date, in
// the app's configured IANA timezone. Using luxon (not naive Date arithmetic) is required here:
// on the two DST-transition nights per year, naive offset math would silently produce an 11h or
// 13h "12h" night shift instead of correctly tracking the wall-clock start/end times.
export function resolveShiftTimes(
  date: string,
  code: { startTime: string; endTime: string; crossesMidnight: boolean },
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  const [startHour, startMinute] = code.startTime.split(':').map(Number)
  const [endHour, endMinute] = code.endTime.split(':').map(Number)

  const startsAt = DateTime.fromISO(date, { zone: timezone }).set({
    hour: startHour,
    minute: startMinute,
    second: 0,
    millisecond: 0,
  })

  let endsAt = DateTime.fromISO(date, { zone: timezone }).set({
    hour: endHour,
    minute: endMinute,
    second: 0,
    millisecond: 0,
  })
  if (code.crossesMidnight) {
    endsAt = endsAt.plus({ days: 1 })
  }

  return { startsAt: startsAt.toJSDate(), endsAt: endsAt.toJSDate() }
}

// The calendar date a shift's end instant falls on, in the app's timezone — used by
// server/utils/dayType.ts to detect whether a night shift's end lands on a given day.
export function calendarDateOf(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toISODate()!
}

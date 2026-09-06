// Generates the full day-skeleton for a month server-side from the calendar itself — the model
// (OCR, later) or a client is never trusted to say which days exist, per the plan's core
// guard against a missed cell silently looking identical to a rest day.
export function generateMonthSkeleton(year: number, month: number): { date: string; day: number }[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    return { date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day }
  })
}

export function firstAndLastOfMonth(year: number, month: number): { first: string; last: string } {
  const skeleton = generateMonthSkeleton(year, month)
  return { first: skeleton[0].date, last: skeleton[skeleton.length - 1].date }
}

export function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const prev = new Date(y, m - 1, d - 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
}

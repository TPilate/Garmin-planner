import type { H3Event } from 'h3'

export function parseYearMonth(event: H3Event): { year: number; month: number } {
  const year = Number(getRouterParam(event, 'year'))
  const month = Number(getRouterParam(event, 'month'))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid year/month' })
  }
  return { year, month }
}

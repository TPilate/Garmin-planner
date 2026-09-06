// One entry per calendar day of the month, using the same server-generated skeleton as the
// roster endpoint — never trusts anything else for which days exist. Each entry is NO_DATA
// (dayType: 'no_data', intensityCeiling: null) unless the month (and the previous day's month)
// is confirmed; see server/utils/dayType.ts for the full rule set.
export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const config = useRuntimeConfig(event)
  const skeleton = generateMonthSkeleton(year, month)

  const days = await Promise.all(skeleton.map(({ date }) => getDaySummary(date, config.appTimezone)))

  return { year, month, days }
})

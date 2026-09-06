export type DayType = 'off' | 'half' | 'pre_night' | 'long_day' | 'post_night' | 'leave' | 'no_data' | 'unknown'
export type IntensityLevel = 'rest' | 'mobility' | 'easy' | 'moderate' | 'hard'

export interface MonthDay {
  date: string
  day: number
  code: string | null
  isLeave: boolean
  // Populated by merging in GET /api/day-summary — absent (undefined) until that fetch resolves.
  dayType?: DayType
  intensityCeiling?: IntensityLevel | null
  metricsDegraded?: boolean | null
}

export interface DaySummaryData {
  date: string
  dayType: DayType
  metricsDegraded: boolean | null
  intensityCeiling: IntensityLevel | null
  garminUsed: boolean
  reason?: string
}

export interface MonthData {
  year: number
  month: number
  status: 'draft' | 'confirmed' | 'ocr_pending' | 'ocr_flagged'
  confirmedAt: string | null
  days: MonthDay[]
}

export interface ConfirmResult {
  ok: boolean
  requiresOverride?: boolean
  workedDays: number
  expectedRange?: [number, number]
}

export function useMonth(year: Ref<number>, month: Ref<number>) {
  const days = ref<MonthDay[]>([])
  const status = ref<MonthData['status']>('draft')
  const loading = ref(false)

  // useRequestFetch() forwards the incoming request's cookies during SSR (plain global $fetch
  // does not) — without it, the first server-rendered load of this page 401s against its own
  // session-protected API even though the browser sent a valid session cookie.
  const requestFetch = useRequestFetch()

  async function load() {
    loading.value = true
    try {
      const data = await requestFetch<MonthData>(`/api/roster/${year.value}/${month.value}`)
      days.value = data.days
      status.value = data.status
    }
    finally {
      loading.value = false
    }
  }

  // Separate fetch, merged in by date — day-summary only returns real data for a CONFIRMED
  // month (everything else is NO_DATA), so this is safe to call unconditionally after load().
  async function loadDaySummaries() {
    const data = await requestFetch<{ days: DaySummaryData[] }>(`/api/day-summary/${year.value}/${month.value}`)
    const summaryByDate = new Map(data.days.map(s => [s.date, s]))
    for (const day of days.value) {
      const summary = summaryByDate.get(day.date)
      if (!summary) continue
      day.dayType = summary.dayType
      day.intensityCeiling = summary.intensityCeiling
      day.metricsDegraded = summary.metricsDegraded
    }
  }

  async function save() {
    await requestFetch(`/api/roster/${year.value}/${month.value}`, {
      method: 'PUT',
      body: { assignments: days.value.map(d => ({ date: d.date, code: d.code })) },
    })
    // Saving a previously-confirmed month resets it server-side — mirror that locally so the
    // UI doesn't show a stale "confirmed" badge on an edited-but-unreviewed month.
    status.value = 'draft'
  }

  async function confirmMonth(override = false) {
    return requestFetch<ConfirmResult>(`/api/roster/${year.value}/${month.value}/confirm`, {
      method: 'POST',
      body: { override },
    })
  }

  return { days, status, loading, load, loadDaySummaries, save, confirmMonth }
}

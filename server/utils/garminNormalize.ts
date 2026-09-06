import { garminDailyMetrics } from '~~/db/schema'

type MetricType = 'sleep' | 'hrv' | 'resting_hr' | 'body_battery' | 'training_readiness' | 'stress' | 'activities'
type Source = 'garth' | 'official' | 'terra'

// Field-path guesses below are a FIRST DRAFT. Plan phase 0b (scripts/spike-garth-sync.py) runs
// unattended for 2-3 weeks specifically to confirm garth's real response shapes before this is
// relied upon in production. Every access is defensive (optional chaining / fallbacks) so an
// unexpected shape degrades to "field left null" for that one metric, rather than throwing and
// losing the whole day's normalization.
export async function normalizeGarminPayload(
  source: Source,
  date: string,
  metricType: MetricType,
  rawPayload: any,
): Promise<void> {
  const patch: Record<string, unknown> = {}

  switch (metricType) {
    case 'sleep':
      patch.sleepScore = rawPayload?.dailySleepDTO?.sleepScores?.overall?.value ?? rawPayload?.overallSleepScore ?? null
      patch.sleepDurationMinutes = rawPayload?.dailySleepDTO?.sleepTimeSeconds
        ? Math.round(rawPayload.dailySleepDTO.sleepTimeSeconds / 60)
        : null
      break
    case 'hrv':
      patch.hrvLastNight = rawPayload?.hrvSummary?.lastNightAvg ?? rawPayload?.lastNightAvg ?? null
      patch.hrvStatus = rawPayload?.hrvSummary?.status ?? rawPayload?.status ?? null
      break
    case 'resting_hr':
      patch.restingHr = rawPayload?.restingHeartRate
        ?? rawPayload?.allMetrics?.metricsMap?.WELLNESS_RESTING_HEART_RATE?.[0]?.value
        ?? null
      break
    case 'body_battery': {
      const readings = Array.isArray(rawPayload) ? rawPayload : (rawPayload?.bodyBatteryValuesArray ?? [])
      const values = readings
        .map((r: any) => (Array.isArray(r) ? r[1] : r?.batteryLevel))
        .filter((v: unknown) => typeof v === 'number')
      patch.bodyBatteryHigh = values.length ? Math.max(...values) : null
      patch.bodyBatteryLow = values.length ? Math.min(...values) : null
      break
    }
    case 'training_readiness':
      patch.trainingReadinessScore = rawPayload?.[0]?.score ?? rawPayload?.score ?? null
      break
    case 'stress':
      patch.stressAvg = rawPayload?.avgStressLevel ?? rawPayload?.averageStressLevel ?? null
      break
    case 'activities':
      patch.vo2max = rawPayload?.[0]?.vO2MaxValue ?? null
      break
  }

  await db.insert(garminDailyMetrics)
    .values({ date, source, normalizedAt: new Date(), ...patch } as typeof garminDailyMetrics.$inferInsert)
    .onConflictDoUpdate({
      target: garminDailyMetrics.date,
      // Only the columns touched by THIS metric type are overwritten — fields normalized from
      // other metric types on the same date (already-inserted rows) are left untouched.
      set: { ...patch, source, normalizedAt: new Date() },
    })
}

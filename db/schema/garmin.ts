import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

// Append-only, deliberately not upserted: favors auditability (never lose an earlier fetch if a
// Garmin-reported value shifts on a later pull) over storage minimalism — the whole dataset is
// single-digit MB over years. garminNormalize.ts must always read the most recent row per
// (source, date, metricType). Swappable-source design: 'official'/'terra' can be added without
// any schema change once the sourcing path changes.
export const rawGarminPayloads = sqliteTable(
  'raw_garmin_payloads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source', { enum: ['garth', 'official', 'terra'] }).notNull(),
    date: text('date').notNull(), // local calendar date this payload describes
    metricType: text('metric_type', {
      enum: ['sleep', 'hrv', 'resting_hr', 'body_battery', 'training_readiness', 'stress', 'activities'],
    }).notNull(),
    rawJson: text('raw_json').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => ({
    lookupIdx: index('raw_garmin_lookup_idx').on(t.source, t.date, t.metricType, t.fetchedAt),
  }),
)

// Normalized, one row per day. Raw fields (restingHr, hrvLastNight) are kept separate from
// Garmin's own derived interpretations (hrvStatus, sleepScore, trainingReadinessScore, body
// battery) because the raw values survive shift work better — see server/utils/baseline.ts,
// which only ever reads restingHr/hrvLastNight, never the derived columns.
export const garminDailyMetrics = sqliteTable(
  'garmin_daily_metrics',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    restingHr: integer('resting_hr'),
    hrvLastNight: integer('hrv_last_night'), // ms, raw
    hrvStatus: text('hrv_status'), // Garmin-derived label, reference only — never trusted on degraded days
    sleepScore: integer('sleep_score'),
    sleepDurationMinutes: integer('sleep_duration_minutes'),
    bodyBatteryHigh: integer('body_battery_high'),
    bodyBatteryLow: integer('body_battery_low'),
    trainingReadinessScore: integer('training_readiness_score'),
    stressAvg: integer('stress_avg'),
    vo2max: integer('vo2max'),
    source: text('source', { enum: ['garth', 'official', 'terra'] }).notNull(),
    normalizedAt: integer('normalized_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => ({
    dateUnique: unique('garmin_daily_metrics_date_unique').on(t.date),
  }),
)

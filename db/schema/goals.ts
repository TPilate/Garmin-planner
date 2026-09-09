import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// One row per discipline. getDisciplineProgress() (server/utils/trainingPlan.ts) reads
// planStartDate/weeklyFrequencyTarget/blockLengthWeeks from here but never writes back a
// "current block" counter — the current block/week/phase is recomputed from logged_sessions
// every time, the same pattern dayType.ts's computeBaseline() uses for the Garmin baseline.
// See docs/superpowers/specs/2026-09-08-training-plan-session-prescription-design.md.
export const disciplineGoals = sqliteTable('discipline_goals', {
  discipline: text('discipline', { enum: ['running', 'swimming', 'strength', 'cycling'] }).primaryKey(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  weeklyFrequencyTarget: integer('weekly_frequency_target').notNull(),
  blockLengthWeeks: integer('block_length_weeks').notNull().default(4),
  planStartDate: text('plan_start_date').notNull(), // 'YYYY-MM-DD', Monday-aligned block/week counting starts here
  // Manually entered starting level (threshold pace, swim pace/100m, key lift weights...).
  // Shape is discipline-specific and intentionally free-form JSON, like session_templates.structureJson.
  baselineJson: text('baseline_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
})

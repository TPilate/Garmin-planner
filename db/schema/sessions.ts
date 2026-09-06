import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Phase 6 (not wired to any UI yet). Sketched now so the MVP schema doesn't box these out later.
export const sessionTemplates = sqliteTable('session_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  discipline: text('discipline'),
  targetIntensity: text('target_intensity', { enum: ['mobility', 'easy', 'moderate', 'hard'] }),
  structureJson: text('structure_json'), // flexible: intervals, sets/reps, etc.
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const loggedSessions = sqliteTable(
  'logged_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    sessionTemplateId: integer('session_template_id').references(() => sessionTemplates.id),
    // Snapshot of what dayType.ts suggested at log time, so later changes to the derivation
    // rules never rewrite history for sessions already logged.
    plannedIntensityCeiling: text('planned_intensity_ceiling'),
    actualRpe: integer('actual_rpe'),
    actualDurationMinutes: integer('actual_duration_minutes'),
    notes: text('notes'),
    garminActivityId: text('garmin_activity_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => ({
    dateIdx: index('logged_sessions_date_idx').on(t.date),
  }),
)

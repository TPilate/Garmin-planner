import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

// Shift codes are hospital-specific and change over time — never hardcode J/N/1-2 semantics
// in application logic. `category` is what server/utils/dayType.ts switches on, so renaming or
// adding a code never requires touching derivation logic. An unrecognized category is a
// deliberate fail-safe case in dayType.ts (treated as rest), not a crash.
export const shiftCodes = sqliteTable('shift_codes', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  startTime: text('start_time').notNull(), // 'HH:MM' local wall-clock template
  endTime: text('end_time').notNull(),
  crossesMidnight: integer('crosses_midnight', { mode: 'boolean' }).notNull().default(false),
  durationMinutes: integer('duration_minutes').notNull(),
  category: text('category', { enum: ['long_day', 'night', 'half_day'] }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
})

// Coverage tracking at month granularity. 'confirmed' is the ONLY status the scheduler trusts —
// absence of a confirmed month must render as "no data", never as "assume free". 'draft' is an
// in-progress manual entry; 'ocr_pending'/'ocr_flagged' are reserved for phase 5 pre-fill review.
export const rosterMonths = sqliteTable(
  'roster_months',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    year: integer('year').notNull(),
    month: integer('month').notNull(), // 1-12
    status: text('status', { enum: ['draft', 'confirmed', 'ocr_pending', 'ocr_flagged'] })
      .notNull()
      .default('draft'),
    source: text('source', { enum: ['manual', 'ocr'] }).notNull().default('manual'),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
  },
  t => ({
    yearMonthUnique: unique('roster_months_year_month_unique').on(t.year, t.month),
  }),
)

// Only WORKED shifts are stored. Rest is derived from absence within a confirmed month — never
// stored as its own row — to avoid desync between shift rows and rest rows.
export const shifts = sqliteTable(
  'shifts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(), // 'YYYY-MM-DD', the day the shift STARTS
    code: text('code')
      .notNull()
      .references(() => shiftCodes.code),
    // Resolved absolute instants, not date+code — required because 'N' crosses midnight and
    // every availability/day-type query would otherwise need special-case logic.
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(), // may fall on date+1
    source: text('source', { enum: ['manual', 'ocr'] }).notNull().default('manual'),
    rosterMonthId: integer('roster_month_id')
      .notNull()
      .references(() => rosterMonths.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
  },
  t => ({
    dateUnique: unique('shifts_date_unique').on(t.date),
    monthIdx: index('shifts_roster_month_idx').on(t.rosterMonthId),
  }),
)

// Lets her tag a stretch of empty days as leave/vacation during review — distinguishes a taper
// opportunity or illness from a plain rest day, which the roster alone can't tell apart.
export const leavePeriods = sqliteTable(
  'leave_periods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startDate: text('start_date').notNull(), // inclusive
    endDate: text('end_date').notNull(), // inclusive
    type: text('type', { enum: ['vacation', 'sick', 'other'] }).notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('now')*1000)`),
  },
  t => ({
    rangeIdx: index('leave_periods_range_idx').on(t.startDate, t.endDate),
  }),
)

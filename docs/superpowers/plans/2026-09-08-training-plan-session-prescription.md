# Phase 6 — Plans d'entraînement & prescription de séances — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing per-day intensity ceiling (`server/utils/dayType.ts`) into a concrete, discipline-specific session prescription for course à pied, natation and musculation (vélo modeled but inactive), adapted to the real free-time window around each shift, with load-based periodization per discipline recomputed from logged history rather than stored as mutable state.

**Architecture:** A new pure-computation module `server/utils/trainingPlan.ts` (same family as `dayType.ts`) layers on top of the existing `getDaySummary()` without modifying it: `getAvailableWindow()` derives free minutes from shift `startsAt`/`endsAt`, `getDisciplineProgress()` recomputes each discipline's block/week/phase from `logged_sessions` history, and `getDailyPrescription()` combines both with the day's intensity ceiling to pick one `session_templates` row. A thin persistence wrapper (`ensurePlannedSession`) upserts a `logged_sessions(status='planned')` row on first read of a given date, which the UI later flips to `completed`/`skipped`.

**Tech Stack:** Nuxt 4 (Nitro server routes), Drizzle ORM + `@libsql/client` (SQLite/Turso), Luxon (timezone-aware date math), Zod (API validation), Vitest (unit tests).

**Spec:** `docs/superpowers/specs/2026-09-08-training-plan-session-prescription-design.md`

## Global Constraints

- Node **≥20.19 or ≥22.12** is required (Nuxt 4.5.2 / oxc-parser) — run `node --version` before `npm run dev` or `npm test` if unsure.
- If `node_modules` ever needs reinstalling, use `npm install --legacy-peer-deps` (documented npm arborist bug with this project's peer-dependency graph) — never plain `npm install`.
- DB driver is `@libsql/client` everywhere (dev = local file, prod = Turso) — never introduce `better-sqlite3` or any other binding.
- All new/changed tables go through Drizzle migrations: `npm run db:generate` then `npm run db:migrate`. Tests never touch the dev DB — they run against a dedicated file-based test DB migrated fresh in `test/setup.ts`.
- Any time math involving shift `startsAt`/`endsAt` MUST use `luxon` on the app's configured IANA timezone (`APP_TIMEZONE`, via `useRuntimeConfig(event).appTimezone` server-side or `TEST_TZ` in tests) — never naive `Date` arithmetic (DST risk, already burned once in this project per `PROJECT_LOG.md`).
- "1 session per day max" is enforced at the DB level with a unique constraint on `logged_sessions.date`, not just in application logic.
- Garmin ingestion (`garth` / `python-worker`) is explicitly out of scope for this plan — no changes to it, no MCP server, no official-API integration.
- Cycling exists in the data model (`discipline_goals`, `session_templates.discipline` enum) with `active=false` and no seeded templates — do not build cycling-specific access-constraint logic (home-trainer vs outdoor) in this plan.
- No Garmin-activity auto-detection of completed sessions in this plan — closing the loop is manual logging only, via the existing `logged_sessions.actualRpe`/`actualDurationMinutes`/`notes` fields.
- Server code follows the existing convention of explicit imports (`import { db } from '~~/db/client'`, etc.) rather than relying on Nitro auto-import, so every new `server/utils/*.ts` file also runs unmodified under plain Vitest.

---

## Task 1: Schema — `discipline_goals` + `session_templates`/`logged_sessions` extensions

**Files:**
- Create: `db/schema/goals.ts`
- Modify: `db/schema/sessions.ts` (full replacement below)
- Modify: `db/schema/index.ts`
- Modify: `test/helpers.ts` (extend `resetTables()`)
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces: `disciplineGoals` table (`discipline` PK enum `'running'|'swimming'|'strength'|'cycling'`, `active`, `weeklyFrequencyTarget`, `blockLengthWeeks` default 4, `planStartDate`, `baselineJson`, `createdAt`/`updatedAt`). `sessionTemplates` gains `durationMinutes` (not null), `phase` (enum `'build'|'deload'|'any'`, default `'any'`), and `discipline`/`targetIntensity` become not-null enums. `loggedSessions` gains `status` (enum `'planned'|'completed'|'skipped'`, default `'planned'`) and a unique constraint on `date`.

- [ ] **Step 1: Create `db/schema/goals.ts`**

```typescript
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
```

- [ ] **Step 2: Replace `db/schema/sessions.ts` in full**

```typescript
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

// Phase 6 — session prescription. See
// docs/superpowers/specs/2026-09-08-training-plan-session-prescription-design.md
export const sessionTemplates = sqliteTable('session_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  discipline: text('discipline', { enum: ['running', 'swimming', 'strength', 'cycling'] }).notNull(),
  targetIntensity: text('target_intensity', { enum: ['mobility', 'easy', 'moderate', 'hard'] }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  // 'any' matches regardless of the discipline's current periodization phase — most templates
  // (technique work, general easy sessions) aren't phase-specific; only build-only interval/
  // threshold work and deload-only easy sessions need a real value here.
  phase: text('phase', { enum: ['build', 'deload', 'any'] }).notNull().default('any'),
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
    // 'planned' = generated by getDailyPrescription()/ensurePlannedSession(), not yet acted on.
    // Flipped to 'completed'/'skipped' by POST /api/training/log.
    status: text('status', { enum: ['planned', 'completed', 'skipped'] }).notNull().default('planned'),
    actualRpe: integer('actual_rpe'),
    actualDurationMinutes: integer('actual_duration_minutes'),
    notes: text('notes'),
    garminActivityId: text('garmin_activity_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => ({
    dateIdx: index('logged_sessions_date_idx').on(t.date),
    // Enforces "1 session per day max" (design doc decision) at the DB level, not just in
    // application logic — ensurePlannedSession()'s upsert relies on this constraint.
    dateUnique: unique('logged_sessions_date_unique').on(t.date),
  }),
)
```

- [ ] **Step 3: Add the barrel export**

In `db/schema/index.ts`, add a new line (order doesn't matter, keep alphabetical-ish with the rest):

```typescript
export * from './shifts'
export * from './garmin'
export * from './ocr'
export * from './sessions'
export * from './goals'
```

- [ ] **Step 4: Extend `resetTables()` in `test/helpers.ts`**

Add the imports and delete the new tables **before** `shifts`/etc (order doesn't matter relative to those, but `loggedSessions` must be deleted before `sessionTemplates` because of the FK):

```typescript
import { eq } from 'drizzle-orm'
import { db } from '~~/db/client'
import { disciplineGoals, garminDailyMetrics, leavePeriods, loggedSessions, rosterMonths, sessionTemplates, shiftCodes, shifts } from '~~/db/schema'
import { resolveShiftTimes } from '../server/utils/shiftResolution'

export const TEST_TZ = 'Europe/Paris'

export async function resetTables() {
  await db.delete(loggedSessions)
  await db.delete(sessionTemplates)
  await db.delete(disciplineGoals)
  await db.delete(shifts)
  await db.delete(leavePeriods)
  await db.delete(garminDailyMetrics)
  await db.delete(rosterMonths)
  await db.delete(shiftCodes)
}
```

(Leave the rest of `test/helpers.ts` — `seedShiftCodes`, `addShift`, etc. — untouched.)

- [ ] **Step 5: Generate and apply the migration**

Run:
```bash
npm run db:generate
npm run db:migrate
```
Expected: a new file appears under `db/migrations/` (e.g. `0001_*.sql`) containing `CREATE TABLE discipline_goals`, the `ALTER TABLE session_templates` columns, and the `logged_sessions` changes; `db:migrate` reports it applied against `db/local.db` with no errors.

- [ ] **Step 6: Write `test/schema.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~~/db/client'
import { disciplineGoals, loggedSessions, sessionTemplates } from '~~/db/schema'
import { resetTables } from './helpers'

beforeEach(async () => {
  await resetTables()
})

describe('discipline_goals schema', () => {
  it('stores a goal and applies the blockLengthWeeks default', async () => {
    await db.insert(disciplineGoals).values({
      discipline: 'running',
      active: true,
      weeklyFrequencyTarget: 3,
      planStartDate: '2026-08-31',
    })
    const row = await db.query.disciplineGoals.findFirst({ where: (t, { eq }) => eq(t.discipline, 'running') })
    expect(row?.blockLengthWeeks).toBe(4)
    expect(row?.active).toBe(true)
  })
})

describe('session_templates schema', () => {
  it('stores durationMinutes and phase', async () => {
    const now = new Date()
    const [row] = await db.insert(sessionTemplates).values({
      name: 'Footing facile',
      discipline: 'running',
      targetIntensity: 'easy',
      durationMinutes: 30,
      phase: 'build',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }).returning()
    expect(row.durationMinutes).toBe(30)
    expect(row.phase).toBe('build')
  })
})

describe('logged_sessions schema', () => {
  async function seedTemplate() {
    const now = new Date()
    const [row] = await db.insert(sessionTemplates).values({
      name: 'Footing facile',
      discipline: 'running',
      targetIntensity: 'easy',
      durationMinutes: 30,
      phase: 'any',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }).returning()
    return row
  }

  it('defaults status to planned', async () => {
    const template = await seedTemplate()
    const now = new Date()
    const [row] = await db.insert(loggedSessions).values({
      date: '2026-09-16',
      sessionTemplateId: template.id,
      createdAt: now,
      updatedAt: now,
    }).returning()
    expect(row.status).toBe('planned')
  })

  it('rejects a second row for the same date (1 session/day max)', async () => {
    const template = await seedTemplate()
    const now = new Date()
    await db.insert(loggedSessions).values({
      date: '2026-09-15', sessionTemplateId: template.id, status: 'planned', createdAt: now, updatedAt: now,
    })
    await expect(
      db.insert(loggedSessions).values({
        date: '2026-09-15', sessionTemplateId: template.id, status: 'planned', createdAt: now, updatedAt: now,
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- test/schema.test.ts`
Expected: 3 tests pass (dayType.test.ts also still runs and passes if you run `npm test` without a filter).

- [ ] **Step 8: Commit**

```bash
git add db/schema/goals.ts db/schema/sessions.ts db/schema/index.ts db/migrations test/helpers.ts test/schema.test.ts
git commit -m "feat(schema): add discipline_goals, extend session_templates/logged_sessions for phase 6"
```

---

## Task 2: `server/utils/trainingPlan.ts` — `getAvailableWindow`

**Files:**
- Create: `server/utils/trainingPlan.ts`
- Test: `test/trainingPlan.test.ts`

**Interfaces:**
- Consumes: `shifts` table (via `db.query.shifts.findFirst`, same pattern as `dayType.ts:92-95`), `TEST_TZ`/`addShift`/`seedShiftCodes`/`confirmMonth`/`resetTables` from `test/helpers.ts`.
- Produces: `AvailableWindow { minutesAvailable: number; reason: string }`, `getAvailableWindow(date: string, timezone: string): Promise<AvailableWindow>`, exported constant `NO_SHIFT_MINUTES = 240`.

- [ ] **Step 1: Write the failing tests**

Create `test/trainingPlan.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { getAvailableWindow, NO_SHIFT_MINUTES } from '../server/utils/trainingPlan'
import { addShift, confirmMonth, resetTables, seedShiftCodes, TEST_TZ } from './helpers'

beforeEach(async () => {
  await resetTables()
  await seedShiftCodes()
})

describe('getAvailableWindow', () => {
  it('returns the default window when there is no shift that day', async () => {
    const window = await getAvailableWindow('2026-09-15', TEST_TZ)
    expect(window.minutesAvailable).toBe(NO_SHIFT_MINUTES)
    expect(window.reason).toBe('no shift this day')
  })

  it('HALF (1/2, 07:00-14:00): the bigger free block is the evening, after the shift', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', '1/2', rm.id)
    const window = await getAvailableWindow('2026-09-15', TEST_TZ)
    expect(window.minutesAvailable).toBe(600) // 24:00 - 14:00
    expect(window.reason).toBe('after shift')
  })

  it('LONG_DAY (J, 07:00-20:00): the bigger free block is early morning, before the shift', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', 'J', rm.id)
    const window = await getAvailableWindow('2026-09-15', TEST_TZ)
    expect(window.minutesAvailable).toBe(420) // 07:00 - 00:00
    expect(window.reason).toBe('before shift')
  })

  it('PRE_NIGHT (N starting today, 20:00-08:00+1): the whole day before the shift is free', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', 'N', rm.id)
    const window = await getAvailableWindow('2026-09-15', TEST_TZ)
    expect(window.minutesAvailable).toBe(1200) // 20:00 - 00:00
    expect(window.reason).toBe('before shift')
  })
})
```

Note: `addShift(date, code, rosterMonthId)` in `test/helpers.ts` needs a real `rosterMonthId` to satisfy the FK — always create one via `confirmMonth(2026, 9)` and pass `rm.id`, even though `getAvailableWindow` itself never checks roster confirmation status (it reads `shifts` directly, never `getDaySummary`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/trainingPlan.test.ts`
Expected: FAIL — `Cannot find module '../server/utils/trainingPlan'`.

- [ ] **Step 3: Implement `getAvailableWindow`**

Create `server/utils/trainingPlan.ts`:

```typescript
import { eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '~~/db/client'
import { shifts } from '~~/db/schema'

// No shift row this day (off/leave) -> a generous but bounded default, so a full rest day never
// suggests an unrealistically long single session. Deliberately raw (see design doc): this does
// NOT model reasonable wake/sleep hours, so a shift starting at 07:00 reports up to 420 "free"
// minutes before it even though most of that is sleep time. The day's intensity ceiling (already
// capped for long_day/pre_night by dayType.ts) is what actually keeps prescriptions sane on
// those days — revisit if this produces bad suggestions in practice.
export const NO_SHIFT_MINUTES = 240

export interface AvailableWindow {
  minutesAvailable: number
  reason: string
}

// Computed straight from shifts.startsAt/endsAt, independent of the day's intensity ceiling.
// A post_night day's ceiling is already 'rest' (dayType.ts), and getDailyPrescription() never
// calls this for a 'rest' day — so this function never needs to reason about a PREVIOUS day's
// night shift bleeding into today.
export async function getAvailableWindow(date: string, timezone: string): Promise<AvailableWindow> {
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.date, date) })
  if (!shift) {
    return { minutesAvailable: NO_SHIFT_MINUTES, reason: 'no shift this day' }
  }

  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf('day')
  const dayEnd = dayStart.plus({ days: 1 })
  const startsAt = DateTime.fromJSDate(shift.startsAt, { zone: timezone })
  const endsAt = DateTime.fromJSDate(shift.endsAt, { zone: timezone })

  const beforeMinutes = Math.max(0, startsAt.diff(dayStart, 'minutes').minutes)
  const afterMinutes = Math.max(0, dayEnd.diff(endsAt, 'minutes').minutes)

  return beforeMinutes >= afterMinutes
    ? { minutesAvailable: beforeMinutes, reason: 'before shift' }
    : { minutesAvailable: afterMinutes, reason: 'after shift' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/trainingPlan.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add server/utils/trainingPlan.ts test/trainingPlan.test.ts
git commit -m "feat(training-plan): compute available time window from shift start/end"
```

---

## Task 3: `getDisciplineProgress` — computed periodization

**Files:**
- Modify: `server/utils/trainingPlan.ts`
- Modify: `test/helpers.ts` (add fixtures)
- Modify: `test/trainingPlan.test.ts`

**Interfaces:**
- Consumes: `disciplineGoals`, `sessionTemplates`, `loggedSessions` tables; `Discipline` type (introduced here).
- Produces: `Discipline = 'running' | 'swimming' | 'strength' | 'cycling'`, `PlanPhase = 'build' | 'deload'`, `DisciplineProgress { discipline, blockNumber, weekInBlock, phase, completedThisWeek, weeklyFrequencyTarget, deficit, lastSessionDate }`, `getDisciplineProgress(discipline: Discipline, asOfDate: string): Promise<DisciplineProgress | null>`.

- [ ] **Step 1: Add test fixtures to `test/helpers.ts`**

Append to `test/helpers.ts` (after `addLeave`, keep existing imports and add the new table imports to the existing `import { ... } from '~~/db/schema'` line from Task 1):

```typescript
export async function addDisciplineGoal(overrides: {
  discipline: 'running' | 'swimming' | 'strength' | 'cycling'
  active?: boolean
  weeklyFrequencyTarget?: number
  blockLengthWeeks?: number
  planStartDate?: string
}) {
  await db.insert(disciplineGoals).values({
    active: true,
    weeklyFrequencyTarget: 3,
    blockLengthWeeks: 4,
    planStartDate: '2026-08-31',
    ...overrides,
  })
}

export async function addSessionTemplate(overrides: {
  name?: string
  discipline?: 'running' | 'swimming' | 'strength' | 'cycling'
  targetIntensity?: 'mobility' | 'easy' | 'moderate' | 'hard'
  durationMinutes?: number
  phase?: 'build' | 'deload' | 'any'
} = {}) {
  const now = new Date()
  const [row] = await db.insert(sessionTemplates).values({
    name: 'Test session',
    discipline: 'running',
    targetIntensity: 'easy',
    durationMinutes: 30,
    phase: 'any',
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning()
  return row
}

export async function addLoggedSession(date: string, sessionTemplateId: number, status: 'planned' | 'completed' | 'skipped' = 'completed') {
  const now = new Date()
  await db.insert(loggedSessions).values({ date, sessionTemplateId, status, createdAt: now, updatedAt: now })
}
```

- [ ] **Step 2: Write the failing tests**

Append to `test/trainingPlan.test.ts`:

```typescript
import { getDisciplineProgress } from '../server/utils/trainingPlan'
import { addDisciplineGoal, addLoggedSession, addSessionTemplate } from './helpers'

describe('getDisciplineProgress', () => {
  it('returns null when the discipline has no goal configured', async () => {
    const progress = await getDisciplineProgress('cycling', '2026-09-15')
    expect(progress).toBeNull()
  })

  it('returns null when the discipline goal is inactive', async () => {
    await addDisciplineGoal({ discipline: 'cycling', active: false })
    const progress = await getDisciplineProgress('cycling', '2026-09-15')
    expect(progress).toBeNull()
  })

  it('a week that meets the completion threshold advances weekInBlock', async () => {
    // weeklyFrequencyTarget=3 -> threshold=2 completed sessions/week. blockLengthWeeks=2 -> cycle of 3 weeks.
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, blockLengthWeeks: 2, planStartDate: '2026-08-31' })
    const template = await addSessionTemplate({ discipline: 'running' })
    // Week 1: Mon 2026-08-31 - Sun 2026-09-06 -> 2 completed sessions (meets threshold).
    await addLoggedSession('2026-09-01', template.id, 'completed')
    await addLoggedSession('2026-09-03', template.id, 'completed')

    const progress = await getDisciplineProgress('running', '2026-09-07') // Monday of week 2
    expect(progress?.blockNumber).toBe(1)
    expect(progress?.weekInBlock).toBe(2)
    expect(progress?.phase).toBe('build')
    expect(progress?.completedThisWeek).toBe(0) // week 2 hasn't happened yet as of its own Monday
    expect(progress?.deficit).toBe(3)
  })

  it('a week that misses the completion threshold repeats instead of advancing', async () => {
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, blockLengthWeeks: 2, planStartDate: '2026-08-31' })
    const template = await addSessionTemplate({ discipline: 'running' })
    // Week 1 meets threshold (2 sessions) -> advances to weekInBlock 2.
    await addLoggedSession('2026-09-01', template.id, 'completed')
    await addLoggedSession('2026-09-03', template.id, 'completed')
    // Week 2 (Mon 09-07 - Sun 09-13) only gets 1 completed session -> below threshold.
    await addLoggedSession('2026-09-08', template.id, 'completed')

    const progress = await getDisciplineProgress('running', '2026-09-14') // Monday of week 3
    expect(progress?.weekInBlock).toBe(2) // stayed at 2, week 2 did not advance it to 3
    expect(progress?.blockNumber).toBe(1)
  })

  it('reaching the last week of the block sets phase to deload, and the next successful week wraps to a new block', async () => {
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, blockLengthWeeks: 2, planStartDate: '2026-08-31' })
    const template = await addSessionTemplate({ discipline: 'running' })
    // Weeks 1 and 2 both meet threshold -> weekInBlock goes 1 -> 2 -> 3 (cycle length 3 = deload).
    await addLoggedSession('2026-09-01', template.id, 'completed')
    await addLoggedSession('2026-09-03', template.id, 'completed')
    await addLoggedSession('2026-09-08', template.id, 'completed')
    await addLoggedSession('2026-09-10', template.id, 'completed')

    const deloadWeek = await getDisciplineProgress('running', '2026-09-14') // Monday of week 3
    expect(deloadWeek?.weekInBlock).toBe(3)
    expect(deloadWeek?.phase).toBe('deload')

    // Week 3 (the deload week) also meets threshold -> wraps to a new block.
    await addLoggedSession('2026-09-15', template.id, 'completed')
    await addLoggedSession('2026-09-17', template.id, 'completed')

    const newBlock = await getDisciplineProgress('running', '2026-09-21') // Monday of week 4
    expect(newBlock?.blockNumber).toBe(2)
    expect(newBlock?.weekInBlock).toBe(1)
    expect(newBlock?.phase).toBe('build')
  })

  it('lastSessionDate reflects the most recent completed session, and is null when none exist', async () => {
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, planStartDate: '2026-08-31' })
    const template = await addSessionTemplate({ discipline: 'running' })

    const noneYet = await getDisciplineProgress('running', '2026-09-07')
    expect(noneYet?.lastSessionDate).toBeNull()

    await addLoggedSession('2026-09-01', template.id, 'completed')
    await addLoggedSession('2026-09-03', template.id, 'completed')
    // A 'skipped' session must never count as the last COMPLETED session.
    await addLoggedSession('2026-09-05', template.id, 'skipped')

    const withHistory = await getDisciplineProgress('running', '2026-09-07')
    expect(withHistory?.lastSessionDate).toBe('2026-09-03')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/trainingPlan.test.ts`
Expected: FAIL — `getDisciplineProgress is not exported` (or similar).

- [ ] **Step 4: Implement `getDisciplineProgress`**

Add to `server/utils/trainingPlan.ts`. First, **replace** (not append to) the two existing import lines at the top of the file with:

```typescript
import { and, eq, gte, lte } from 'drizzle-orm'
import { disciplineGoals, loggedSessions, sessionTemplates, shifts } from '~~/db/schema'
```

(`eq` and `shifts` were already imported by Task 2 — this replaces those two lines with the superset needed from here on, it does not add a second, duplicate import from the same module.) Then append the following below the existing `getAvailableWindow`:

```typescript
export type Discipline = 'running' | 'swimming' | 'strength' | 'cycling'
export type PlanPhase = 'build' | 'deload'

export const DISCIPLINES: Discipline[] = ['running', 'swimming', 'strength', 'cycling']

export interface DisciplineProgress {
  discipline: Discipline
  blockNumber: number
  weekInBlock: number
  phase: PlanPhase
  completedThisWeek: number
  weeklyFrequencyTarget: number
  deficit: number
  lastSessionDate: string | null
}

function isoWeekStart(date: string): string {
  return DateTime.fromISO(date).startOf('week').toISODate()! // Monday, per luxon's default ISO week
}

// Recomputes the current block/week/phase from logged_sessions history every time it's called —
// never stores a mutable counter. Mirrors computeBaseline() in dayType.ts: a week only advances
// the block position if enough sessions were actually completed, so a rough month of shift work
// naturally holds the block instead of racing ahead of reality. See design doc "Approche retenue".
export async function getDisciplineProgress(discipline: Discipline, asOfDate: string): Promise<DisciplineProgress | null> {
  const goal = await db.query.disciplineGoals.findFirst({ where: eq(disciplineGoals.discipline, discipline) })
  if (!goal || !goal.active) return null

  const rows = await db
    .select({ date: loggedSessions.date, status: loggedSessions.status })
    .from(loggedSessions)
    .innerJoin(sessionTemplates, eq(loggedSessions.sessionTemplateId, sessionTemplates.id))
    .where(and(
      eq(sessionTemplates.discipline, discipline),
      gte(loggedSessions.date, goal.planStartDate),
      lte(loggedSessions.date, asOfDate),
    ))

  const completedByWeek = new Map<string, number>()
  let lastSessionDate: string | null = null
  for (const row of rows) {
    if (row.status !== 'completed') continue
    const key = isoWeekStart(row.date)
    completedByWeek.set(key, (completedByWeek.get(key) ?? 0) + 1)
    if (!lastSessionDate || row.date > lastSessionDate) lastSessionDate = row.date
  }

  const cycleLength = goal.blockLengthWeeks + 1 // + the deload week
  const completionThreshold = Math.max(0, goal.weeklyFrequencyTarget - 1) // tolerates one missed session

  let blockNumber = 1
  let weekInBlock = 1
  let cursor = DateTime.fromISO(goal.planStartDate).startOf('week')
  const targetWeek = DateTime.fromISO(asOfDate).startOf('week')

  while (cursor < targetWeek) {
    const completed = completedByWeek.get(cursor.toISODate()!) ?? 0
    if (completed >= completionThreshold) {
      if (weekInBlock === cycleLength) {
        weekInBlock = 1
        blockNumber += 1
      }
      else {
        weekInBlock += 1
      }
    }
    cursor = cursor.plus({ weeks: 1 })
  }

  const completedThisWeek = completedByWeek.get(targetWeek.toISODate()!) ?? 0

  return {
    discipline,
    blockNumber,
    weekInBlock,
    phase: weekInBlock === cycleLength ? 'deload' : 'build',
    completedThisWeek,
    weeklyFrequencyTarget: goal.weeklyFrequencyTarget,
    deficit: goal.weeklyFrequencyTarget - completedThisWeek,
    lastSessionDate,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/trainingPlan.test.ts`
Expected: PASS (all tests in the file, including Task 2's).

- [ ] **Step 6: Commit**

```bash
git add server/utils/trainingPlan.ts test/helpers.ts test/trainingPlan.test.ts
git commit -m "feat(training-plan): recompute per-discipline block/week/phase from session history"
```

---

## Task 4: `getDailyPrescription` + `ensurePlannedSession`

**Files:**
- Modify: `server/utils/dayType.ts:11` (export `INTENSITY_ORDER`)
- Modify: `server/utils/trainingPlan.ts`
- Modify: `test/trainingPlan.test.ts`

**Interfaces:**
- Consumes: `getDaySummary` and `INTENSITY_ORDER`/`IntensityLevel` from `./dayType`; `DISCIPLINES`, `getDisciplineProgress`, `getAvailableWindow` from Tasks 2-3.
- Produces: `Prescription { date, hasSession, discipline?, sessionTemplateId?, reason? }`, `getDailyPrescription(date: string, timezone: string): Promise<Prescription>`, `ensurePlannedSession(date: string, timezone: string): Promise<number | null>`.

- [ ] **Step 1: Export `INTENSITY_ORDER` from `dayType.ts`**

In `server/utils/dayType.ts:11`, change:
```typescript
const INTENSITY_ORDER: IntensityLevel[] = ['rest', 'mobility', 'easy', 'moderate', 'hard']
```
to:
```typescript
export const INTENSITY_ORDER: IntensityLevel[] = ['rest', 'mobility', 'easy', 'moderate', 'hard']
```
No other change to this file — every existing internal usage keeps working unmodified.

- [ ] **Step 2: Write the failing tests**

Append to `test/trainingPlan.test.ts`:

```typescript
import { db } from '~~/db/client'
import { ensurePlannedSession, getDailyPrescription } from '../server/utils/trainingPlan'
import { confirmMonth } from './helpers'

describe('getDailyPrescription', () => {
  it('no session on a REST-ceiling day (post_night)', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-14', 'N', rm.id) // ends 2026-09-15 08:00, post_night on the 15th
    const prescription = await getDailyPrescription('2026-09-15', TEST_TZ)
    expect(prescription.hasSession).toBe(false)
  })

  it('no session on a NO_DATA day (roster not confirmed)', async () => {
    const prescription = await getDailyPrescription('2026-09-15', TEST_TZ)
    expect(prescription.hasSession).toBe(false)
  })

  it('picks the discipline with the most urgent weekly deficit', async () => {
    await confirmMonth(2026, 9)
    // Both disciplines want 3/week; running already has 2 completed this week, swimming has 0 ->
    // swimming is more urgent (deficit 3 vs deficit 1).
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, planStartDate: '2026-09-07' })
    await addDisciplineGoal({ discipline: 'swimming', weeklyFrequencyTarget: 3, planStartDate: '2026-09-07' })
    const runningTemplate = await addSessionTemplate({ discipline: 'running', targetIntensity: 'easy', durationMinutes: 30 })
    const swimTemplate = await addSessionTemplate({ discipline: 'swimming', targetIntensity: 'easy', durationMinutes: 30 })
    await addLoggedSession('2026-09-08', runningTemplate.id, 'completed')
    await addLoggedSession('2026-09-09', runningTemplate.id, 'completed')

    const prescription = await getDailyPrescription('2026-09-10', TEST_TZ) // OFF day, ceiling=hard
    expect(prescription.hasSession).toBe(true)
    expect(prescription.discipline).toBe('swimming')
    expect(prescription.sessionTemplateId).toBe(swimTemplate.id)
  })

  it('never picks an inactive discipline even if it would otherwise be most urgent', async () => {
    await confirmMonth(2026, 9)
    await addDisciplineGoal({ discipline: 'cycling', active: false, weeklyFrequencyTarget: 5, planStartDate: '2026-09-07' })
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 1, planStartDate: '2026-09-07' })
    const runningTemplate = await addSessionTemplate({ discipline: 'running', targetIntensity: 'easy', durationMinutes: 30 })
    await addSessionTemplate({ discipline: 'cycling', targetIntensity: 'easy', durationMinutes: 30 })

    const prescription = await getDailyPrescription('2026-09-10', TEST_TZ)
    expect(prescription.discipline).toBe('running')
    expect(prescription.sessionTemplateId).toBe(runningTemplate.id)
  })

  it('no session when the ceiling is too low for every candidate template', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', 'J', rm.id) // long_day -> ceiling mobility
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, planStartDate: '2026-09-07' })
    await addSessionTemplate({ discipline: 'running', targetIntensity: 'easy', durationMinutes: 20 }) // easy > mobility ceiling

    const prescription = await getDailyPrescription('2026-09-15', TEST_TZ)
    expect(prescription.hasSession).toBe(false)
    expect(prescription.reason).toMatch(/no discipline/)
  })
})

describe('ensurePlannedSession', () => {
  it('creates a planned logged_sessions row on first call', async () => {
    await confirmMonth(2026, 9)
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, planStartDate: '2026-09-07' })
    const template = await addSessionTemplate({ discipline: 'running', targetIntensity: 'easy', durationMinutes: 30 })

    const id = await ensurePlannedSession('2026-09-10', TEST_TZ)
    expect(id).not.toBeNull()
    const row = await db.query.loggedSessions.findFirst({ where: (t, { eq }) => eq(t.id, id!) })
    expect(row?.sessionTemplateId).toBe(template.id)
    expect(row?.status).toBe('planned')
  })

  it('never overwrites an already-logged (completed) session', async () => {
    await confirmMonth(2026, 9)
    await addDisciplineGoal({ discipline: 'running', weeklyFrequencyTarget: 3, planStartDate: '2026-09-07' })
    const originalTemplate = await addSessionTemplate({ discipline: 'running', targetIntensity: 'easy', durationMinutes: 30 })
    await addLoggedSession('2026-09-10', originalTemplate.id, 'completed')

    const otherTemplate = await addSessionTemplate({ discipline: 'running', targetIntensity: 'hard', durationMinutes: 30 })
    const id = await ensurePlannedSession('2026-09-10', TEST_TZ)
    const row = await db.query.loggedSessions.findFirst({ where: (t, { eq }) => eq(t.id, id!) })
    expect(row?.sessionTemplateId).toBe(originalTemplate.id) // untouched, not otherTemplate
    expect(row?.status).toBe('completed')
  })

  it('creates no row when there is no session to plan', async () => {
    const id = await ensurePlannedSession('2026-09-15', TEST_TZ) // no confirmed month -> NO_DATA
    expect(id).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/trainingPlan.test.ts`
Expected: FAIL — `getDailyPrescription`/`ensurePlannedSession` not exported.

- [ ] **Step 4: Implement `getDailyPrescription` and `ensurePlannedSession`**

Extend `server/utils/trainingPlan.ts`. **Replace** the file's existing `import { and, eq, gte, lte } from 'drizzle-orm'` line (from Task 3) with the superset below, and add the new `./dayType` import — do not leave the old `drizzle-orm` import line in place alongside the new one (that would be a duplicate-identifier error on `eq`):

```typescript
import { and, eq, gte, lt, lte, or } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db } from '~~/db/client'
import { disciplineGoals, loggedSessions, sessionTemplates, shifts } from '~~/db/schema'
import { getDaySummary, INTENSITY_ORDER, type IntensityLevel } from './dayType'
```

Append:

```typescript
export interface Prescription {
  date: string
  hasSession: boolean
  discipline?: Discipline
  sessionTemplateId?: number
  reason?: string
}

// Avoids suggesting the exact same template on consecutive outings, but only if excluding
// recently-used templates still leaves a candidate — "avoid repetition" must never be the reason
// a day ends up with NO session.
const RECENT_VARIETY_DAYS = 14

async function getRecentlyUsedTemplateIds(date: string): Promise<Set<number>> {
  const cutoff = DateTime.fromISO(date).minus({ days: RECENT_VARIETY_DAYS }).toISODate()!
  const rows = await db.query.loggedSessions.findMany({
    where: and(gte(loggedSessions.date, cutoff), lt(loggedSessions.date, date)),
    columns: { sessionTemplateId: true },
  })
  return new Set(rows.map(r => r.sessionTemplateId).filter((id): id is number => id !== null))
}

async function pickTemplate(
  discipline: Discipline,
  ceiling: IntensityLevel,
  minutesAvailable: number,
  phase: PlanPhase,
  excludeIds: Set<number>,
): Promise<{ id: number } | null> {
  const maxIndex = INTENSITY_ORDER.indexOf(ceiling)
  const candidates = await db.query.sessionTemplates.findMany({
    where: and(
      eq(sessionTemplates.discipline, discipline),
      eq(sessionTemplates.isArchived, false),
      lte(sessionTemplates.durationMinutes, minutesAvailable),
      or(eq(sessionTemplates.phase, phase), eq(sessionTemplates.phase, 'any')),
    ),
  })
  const fitting = candidates.filter(t => INTENSITY_ORDER.indexOf(t.targetIntensity) <= maxIndex)
  if (fitting.length === 0) return null

  const fresh = fitting.filter(t => !excludeIds.has(t.id))
  const pool = fresh.length > 0 ? fresh : fitting
  // Smallest id wins among ties — deterministic, so re-reading an un-acted-on day always
  // returns the same proposal.
  return pool.reduce((min, t) => (t.id < min.id ? t : min))
}

export async function getDailyPrescription(date: string, timezone: string): Promise<Prescription> {
  const daySummary = await getDaySummary(date, timezone)
  if (daySummary.intensityCeiling === null || daySummary.intensityCeiling === 'rest') {
    return { date, hasSession: false, reason: daySummary.reason ?? `day type ${daySummary.dayType} allows no session` }
  }
  const ceiling = daySummary.intensityCeiling

  const window = await getAvailableWindow(date, timezone)

  const progresses: DisciplineProgress[] = []
  for (const discipline of DISCIPLINES) {
    const progress = await getDisciplineProgress(discipline, date)
    if (progress) progresses.push(progress)
  }

  const isoWeekday = DateTime.fromISO(date, { zone: timezone }).weekday // 1=Mon..7=Sun
  const daysLeftInWeek = 8 - isoWeekday // includes today

  const sentinel = '0000-00-00' // sorts before every real date -> "never trained" goes first
  const ranked = progresses
    .filter(p => p.deficit > 0)
    .sort((a, b) => {
      const urgencyDiff = (b.deficit / daysLeftInWeek) - (a.deficit / daysLeftInWeek)
      if (urgencyDiff !== 0) return urgencyDiff
      const aLast = a.lastSessionDate ?? sentinel
      const bLast = b.lastSessionDate ?? sentinel
      return aLast < bLast ? -1 : aLast > bLast ? 1 : 0
    })

  const excludeIds = await getRecentlyUsedTemplateIds(date)

  for (const progress of ranked) {
    const template = await pickTemplate(progress.discipline, ceiling, window.minutesAvailable, progress.phase, excludeIds)
    if (template) {
      return { date, hasSession: true, discipline: progress.discipline, sessionTemplateId: template.id }
    }
  }

  return { date, hasSession: false, reason: 'no discipline had a matching session template for this ceiling/window' }
}

// Idempotent: only writes when no logged_sessions row exists yet for this date. Never touches
// an existing row, whatever its status — see design doc "Cas limites".
export async function ensurePlannedSession(date: string, timezone: string): Promise<number | null> {
  const existing = await db.query.loggedSessions.findFirst({ where: eq(loggedSessions.date, date) })
  if (existing) return existing.id

  const prescription = await getDailyPrescription(date, timezone)
  if (!prescription.hasSession) return null

  const daySummary = await getDaySummary(date, timezone)
  const now = new Date()
  const [inserted] = await db.insert(loggedSessions).values({
    date,
    sessionTemplateId: prescription.sessionTemplateId!,
    plannedIntensityCeiling: daySummary.intensityCeiling,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: loggedSessions.date }).returning({ id: loggedSessions.id })

  if (inserted) return inserted.id
  // Another concurrent call won the race — re-read rather than assume failure.
  const row = await db.query.loggedSessions.findFirst({ where: eq(loggedSessions.date, date) })
  return row?.id ?? null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/trainingPlan.test.ts`
Expected: PASS (all tests in the file). Then run `npm test` (no filter) to confirm `dayType.test.ts` and `schema.test.ts` are still green.

- [ ] **Step 6: Commit**

```bash
git add server/utils/dayType.ts server/utils/trainingPlan.ts test/trainingPlan.test.ts
git commit -m "feat(training-plan): getDailyPrescription + ensurePlannedSession"
```

---

## Task 5: Seed the starter session template library

**Files:**
- Modify: `db/seed.ts`

**Interfaces:**
- Consumes: `sessionTemplates` schema from Task 1.
- Produces: 14 rows in `session_templates` (5 running, 4 swimming, 5 strength; none for cycling — inactive per design doc scope).

- [ ] **Step 1: Extend `db/seed.ts`**

Add alongside `SEED_CODES` (keep the existing shift-code seeding untouched):

```typescript
// Starter library, curated rather than exhaustive (YAGNI) — enough for getDailyPrescription() to
// have real candidates at every ceiling level it can encounter. No cycling templates: the
// discipline is modeled but inactive until the bike is available (design doc, "Hors scope").
// Strength carries the only 'mobility' templates on purpose — a running/swimming "mobility"
// session isn't a meaningful concept, and CEILING_BY_DAY_TYPE only ever requires ceiling='mobility'
// on long_day, where time is the real constraint, not the discipline.
const SEED_SESSION_TEMPLATES = [
  {
    name: 'Footing facile',
    discipline: 'running' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 30,
    phase: 'any' as const,
    structureJson: JSON.stringify({ warmup: '5min marche rapide', main: '20min footing allure conversation', cooldown: '5min marche' }),
  },
  {
    name: 'Sortie longue',
    discipline: 'running' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 75,
    phase: 'build' as const,
    structureJson: JSON.stringify({ warmup: '10min facile', main: '55min endurance fondamentale', cooldown: '10min facile' }),
  },
  {
    name: 'Séance seuil course',
    discipline: 'running' as const,
    targetIntensity: 'moderate' as const,
    durationMinutes: 45,
    phase: 'build' as const,
    structureJson: JSON.stringify({ warmup: '10min facile', main: '3x8min allure seuil / 2min récup trot', cooldown: '10min facile' }),
  },
  {
    name: 'Fractionné VMA',
    discipline: 'running' as const,
    targetIntensity: 'hard' as const,
    durationMinutes: 50,
    phase: 'build' as const,
    structureJson: JSON.stringify({ warmup: '15min progressif', main: '10x400m à VMA / 1min30 récup', cooldown: '10min facile' }),
  },
  {
    name: 'Footing récupération',
    discipline: 'running' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 25,
    phase: 'deload' as const,
    structureJson: JSON.stringify({ warmup: '5min marche', main: '15min footing très facile', cooldown: '5min marche' }),
  },
  {
    name: 'Technique et endurance nage',
    discipline: 'swimming' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 40,
    phase: 'any' as const,
    structureJson: JSON.stringify({ warmup: '200m souple', main: '4x200m technique (éducatifs) + 400m continu facile', cooldown: '100m souple' }),
  },
  {
    name: 'Séance seuil natation',
    discipline: 'swimming' as const,
    targetIntensity: 'moderate' as const,
    durationMinutes: 45,
    phase: 'build' as const,
    structureJson: JSON.stringify({ warmup: '300m souple', main: '6x150m allure seuil / 30s récup', cooldown: '200m souple' }),
  },
  {
    name: 'Fractionné nage',
    discipline: 'swimming' as const,
    targetIntensity: 'hard' as const,
    durationMinutes: 50,
    phase: 'build' as const,
    structureJson: JSON.stringify({ warmup: '300m souple', main: '12x50m rapide / 20s récup', cooldown: '200m souple' }),
  },
  {
    name: 'Récupération nage',
    discipline: 'swimming' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 30,
    phase: 'deload' as const,
    structureJson: JSON.stringify({ warmup: '100m souple', main: '600m continu très facile', cooldown: '100m souple' }),
  },
  {
    name: 'Gainage et mobilité',
    discipline: 'strength' as const,
    targetIntensity: 'mobility' as const,
    durationMinutes: 15,
    phase: 'any' as const,
    structureJson: JSON.stringify({ main: 'Gainage ventral/latéral 3x30s, mobilité hanches/chevilles 5min, étirements 5min' }),
  },
  {
    name: 'Renforcement général',
    discipline: 'strength' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 40,
    phase: 'any' as const,
    structureJson: JSON.stringify({ main: '3 tours : squats x15, pompes x12, fentes x12/jambe, gainage 45s, 90s récup entre tours' }),
  },
  {
    name: 'Force bas du corps',
    discipline: 'strength' as const,
    targetIntensity: 'moderate' as const,
    durationMinutes: 50,
    phase: 'build' as const,
    structureJson: JSON.stringify({ main: 'Squats 4x8, soulevé de terre roumain 4x8, fentes bulgares 3x10/jambe, mollets 3x15' }),
  },
  {
    name: 'Force haut du corps et full body',
    discipline: 'strength' as const,
    targetIntensity: 'hard' as const,
    durationMinutes: 55,
    phase: 'build' as const,
    structureJson: JSON.stringify({ main: 'Développé couché 4x6, tractions 4x6, rowing 4x8, overhead press 3x8, gainage dynamique 3x1min' }),
  },
  {
    name: 'Circuit léger',
    discipline: 'strength' as const,
    targetIntensity: 'easy' as const,
    durationMinutes: 30,
    phase: 'deload' as const,
    structureJson: JSON.stringify({ main: '2 tours légers : squats x12, pompes genoux x10, gainage 30s, mobilité générale 5min' }),
  },
]

async function seedSessionTemplates() {
  const now = new Date()
  for (const t of SEED_SESSION_TEMPLATES) {
    const existing = await db.query.sessionTemplates.findFirst({ where: (row, { eq }) => eq(row.name, t.name) })
    if (existing) continue
    await db.insert(sessionTemplates).values({ ...t, isArchived: false, createdAt: now, updatedAt: now })
  }
  console.log(`Seeded ${SEED_SESSION_TEMPLATES.length} session templates.`)
}
```

Update the `main()` function and imports at the top of `db/seed.ts`:

```typescript
import { db } from './client'
import { sessionTemplates, shiftCodes } from './schema'
```

```typescript
async function main() {
  for (const c of SEED_CODES) {
    await db.insert(shiftCodes).values(c).onConflictDoNothing()
  }
  console.log(`Seeded ${SEED_CODES.length} shift codes.`)
  await seedSessionTemplates()
}
```

(Deliberately no `discipline_goals` seeding here — per the design doc, the starting level/frequency target per discipline is entered manually via the admin screen built in Task 8, not hardcoded.)

- [ ] **Step 2: Run the seed script**

Run: `npx tsx db/seed.ts`
Expected output includes: `Seeded 3 shift codes.` and `Seeded 14 session templates.`

- [ ] **Step 3: Verify in the DB**

Run:
```bash
sqlite3 db/local.db "SELECT discipline, count(*) FROM session_templates GROUP BY discipline;"
```
Expected:
```
running|5
strength|5
swimming|4
```

- [ ] **Step 4: Commit**

```bash
git add db/seed.ts
git commit -m "feat(training-plan): seed starter session template library"
```

---

## Task 6: API — discipline goals CRUD + training month view + session logging

**Files:**
- Create: `server/api/goals.get.ts`
- Create: `server/api/goals.put.ts`
- Create: `server/api/training/[year]/[month].get.ts`
- Create: `server/api/training/log.post.ts`

**Interfaces:**
- Consumes: `ensurePlannedSession`, `getDailyPrescription` from `server/utils/trainingPlan.ts`; `generateMonthSkeleton` from `server/utils/calendar.ts` (Nitro auto-import, same as `day-summary/[year]/[month].get.ts`); `parseYearMonth` from `server/utils/roster.ts`.
- Produces: `GET /api/goals` → `DisciplineGoalRow[]`; `PUT /api/goals` → `{ ok: true }`; `GET /api/training/:year/:month` → `{ year, month, days: TrainingDay[] }` where `TrainingDay = { date, hasSession, discipline?, sessionName?, targetIntensity?, durationMinutes?, structureJson?, status?, reason? }`; `POST /api/training/log` → `{ ok: true }`.

- [ ] **Step 1: `server/api/goals.get.ts`**

```typescript
import { asc } from 'drizzle-orm'
import { disciplineGoals } from '~~/db/schema'

export default defineEventHandler(async () => {
  return db.select().from(disciplineGoals).orderBy(asc(disciplineGoals.discipline))
})
```

- [ ] **Step 2: `server/api/goals.put.ts`**

```typescript
import { z } from 'zod'
import { disciplineGoals } from '~~/db/schema'

const bodySchema = z.object({
  discipline: z.enum(['running', 'swimming', 'strength', 'cycling']),
  active: z.boolean(),
  weeklyFrequencyTarget: z.number().int().positive(),
  blockLengthWeeks: z.number().int().positive(),
  planStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  baselineJson: z.string().nullable().optional(),
})

// Upsert a single discipline goal — same pattern as server/api/shift-codes.put.ts.
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => bodySchema.parse(body))

  await db
    .insert(disciplineGoals)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: disciplineGoals.discipline,
      set: { ...input, updatedAt: new Date() },
    })

  return { ok: true }
})
```

- [ ] **Step 3: `server/api/training/[year]/[month].get.ts`**

```typescript
import { eq } from 'drizzle-orm'
import { loggedSessions, sessionTemplates } from '~~/db/schema'

// One entry per calendar day of the month, generating (and persisting, via ensurePlannedSession)
// a prescription for any day that doesn't have one yet. Mirrors day-summary/[year]/[month].get.ts.
export default defineEventHandler(async (event) => {
  const { year, month } = parseYearMonth(event)
  const config = useRuntimeConfig(event)
  const skeleton = generateMonthSkeleton(year, month)

  const days = await Promise.all(skeleton.map(async ({ date }) => {
    const loggedSessionId = await ensurePlannedSession(date, config.appTimezone)
    if (loggedSessionId === null) {
      const prescription = await getDailyPrescription(date, config.appTimezone)
      return { date, hasSession: false, reason: prescription.reason }
    }

    const row = await db
      .select({
        status: loggedSessions.status,
        actualRpe: loggedSessions.actualRpe,
        actualDurationMinutes: loggedSessions.actualDurationMinutes,
        notes: loggedSessions.notes,
        sessionName: sessionTemplates.name,
        discipline: sessionTemplates.discipline,
        targetIntensity: sessionTemplates.targetIntensity,
        durationMinutes: sessionTemplates.durationMinutes,
        structureJson: sessionTemplates.structureJson,
      })
      .from(loggedSessions)
      .innerJoin(sessionTemplates, eq(loggedSessions.sessionTemplateId, sessionTemplates.id))
      .where(eq(loggedSessions.id, loggedSessionId))
      .then(rows => rows[0])

    return { date, hasSession: true, ...row }
  }))

  return { year, month, days }
})
```

- [ ] **Step 4: `server/api/training/log.post.ts`**

```typescript
import { z } from 'zod'
import { loggedSessions } from '~~/db/schema'

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['completed', 'skipped']),
  actualRpe: z.number().int().min(1).max(10).nullable().optional(),
  actualDurationMinutes: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
})

// Requires a planned row to already exist (or creates one on the fly) — logging always acts on
// the SAME row the day's prescription created, per design doc "Modèle de données".
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => bodySchema.parse(body))
  const config = useRuntimeConfig(event)

  const loggedSessionId = await ensurePlannedSession(input.date, config.appTimezone)
  if (loggedSessionId === null) {
    throw createError({ statusCode: 422, statusMessage: 'No session was prescribed for this date' })
  }

  await db.update(loggedSessions)
    .set({
      status: input.status,
      actualRpe: input.actualRpe,
      actualDurationMinutes: input.actualDurationMinutes,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(loggedSessions.id, loggedSessionId))

  return { ok: true }
})
```

Add `import { eq } from 'drizzle-orm'` at the top of this file.

- [ ] **Step 5: Verify via curl (dev server)**

Start the dev server in one terminal: `npm run dev`. In another terminal:

```bash
# Login (adjust APP_PIN to your .env value), keep the cookie jar
curl -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"pin":"'"$APP_PIN"'"}'

# Create/activate a discipline goal
curl -b /tmp/cookies.txt -X PUT http://localhost:3000/api/goals -H 'Content-Type: application/json' \
  -d '{"discipline":"running","active":true,"weeklyFrequencyTarget":3,"blockLengthWeeks":4,"planStartDate":"2026-08-31","baselineJson":null}'
curl -b /tmp/cookies.txt http://localhost:3000/api/goals

# Confirm September's roster is set up already (via the roster UI/API from earlier phases), then:
curl -b /tmp/cookies.txt http://localhost:3000/api/training/2026/9
```

Expected: `PUT /api/goals` → `{"ok":true}`; `GET /api/goals` → array containing the running row; `GET /api/training/2026/9` → `{"year":2026,"month":9,"days":[...]}` with at least some days showing `"hasSession":true` and a `sessionName`, and OFF/no-shift days more likely to have one than long_day ones (mobility ceiling is stricter to satisfy). Then:

```bash
curl -b /tmp/cookies.txt -X POST http://localhost:3000/api/training/log -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-10","status":"completed","actualRpe":6,"actualDurationMinutes":30,"notes":"Facile"}'
curl -b /tmp/cookies.txt http://localhost:3000/api/training/2026/9
```
Expected: the log call returns `{"ok":true}`; the day for `2026-09-10` in the follow-up GET now shows `"status":"completed"` with the same `sessionName` as before (not re-picked).

- [ ] **Step 6: Commit**

```bash
git add server/api/goals.get.ts server/api/goals.put.ts server/api/training
git commit -m "feat(training-plan): API for discipline goals CRUD, monthly prescriptions, and logging"
```

---

## Task 7: Calendar UI — display the prescribed session (read-only)

**Files:**
- Create: `app/components/calendar/SessionBadge.vue`
- Modify: `app/components/calendar/DayCell.vue`
- Modify: `app/components/calendar/MonthGrid.vue`
- Modify: `app/composables/useMonth.ts`
- Modify: `app/pages/roster/[year]/[month].vue`

**Interfaces:**
- Consumes: `GET /api/training/[year]/[month]` from Task 6.
- Produces: `MonthDay` gains `sessionName?: string`, `discipline?: 'running'|'swimming'|'strength'|'cycling'`; `useMonth()` gains `loadTrainingPlan()`.

- [ ] **Step 1: `app/components/calendar/SessionBadge.vue`**

```vue
<script setup lang="ts">
defineProps<{
  sessionName: string
  discipline: 'running' | 'swimming' | 'strength' | 'cycling'
}>()

const DISCIPLINE_ICONS: Record<string, string> = {
  running: '🏃',
  swimming: '🏊',
  strength: '🏋️',
  cycling: '🚴',
}
</script>

<template>
  <span class="session-badge" :title="sessionName">
    {{ DISCIPLINE_ICONS[discipline] ?? '•' }} {{ sessionName }}
  </span>
</template>

<style scoped>
.session-badge {
  display: block;
  font-size: 0.5rem;
  color: #374151;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 100%;
}
</style>
```

- [ ] **Step 2: Extend `app/components/calendar/DayCell.vue`**

Add two new props and render the badge, right after the existing `CalendarIntensityBadge` line (`app/components/calendar/DayCell.vue:36`):

```diff
 defineProps<{
   day: number
   code: string | null
   isLeave: boolean
   disabled?: boolean
   intensityCeiling?: 'rest' | 'mobility' | 'easy' | 'moderate' | 'hard' | null
   metricsDegraded?: boolean | null
+  sessionName?: string | null
+  discipline?: 'running' | 'swimming' | 'strength' | 'cycling' | null
 }>()
```

```diff
     <CalendarIntensityBadge v-if="intensityCeiling !== undefined" :intensity-ceiling="intensityCeiling ?? null" />
+    <CalendarSessionBadge v-if="sessionName && discipline" :session-name="sessionName" :discipline="discipline" />
   </button>
```

- [ ] **Step 3: Pass the new props through `app/components/calendar/MonthGrid.vue`**

```diff
     <CalendarDayCell
       v-for="d in days"
       :key="d.date"
       :day="d.day"
       :code="d.code"
       :is-leave="d.isLeave"
       :disabled="disabled"
       :intensity-ceiling="d.intensityCeiling"
       :metrics-degraded="d.metricsDegraded"
+      :session-name="d.sessionName"
+      :discipline="d.discipline"
       @click="emit('toggle', d.date)"
     />
```

- [ ] **Step 4: Extend `app/composables/useMonth.ts`**

Add to the `MonthDay` interface (`app/composables/useMonth.ts:4-13`):

```diff
 export interface MonthDay {
   date: string
   day: number
   code: string | null
   isLeave: boolean
   dayType?: DayType
   intensityCeiling?: IntensityLevel | null
   metricsDegraded?: boolean | null
+  sessionName?: string | null
+  discipline?: 'running' | 'swimming' | 'strength' | 'cycling' | null
 }
```

Add a new interface and function, and return it from `useMonth()`:

```typescript
export interface TrainingDay {
  date: string
  hasSession: boolean
  discipline?: 'running' | 'swimming' | 'strength' | 'cycling'
  sessionName?: string
  targetIntensity?: string
  durationMinutes?: number
  structureJson?: string | null
  status?: 'planned' | 'completed' | 'skipped'
  reason?: string
}
```

```typescript
  // Separate fetch, merged in by date — same pattern as loadDaySummaries(). Safe to call even
  // for a NO_DATA month: those days just come back with hasSession=false.
  async function loadTrainingPlan() {
    const data = await requestFetch<{ days: TrainingDay[] }>(`/api/training/${year.value}/${month.value}`)
    const byDate = new Map(data.days.map(t => [t.date, t]))
    for (const day of days.value) {
      const training = byDate.get(day.date)
      if (!training?.hasSession) continue
      day.sessionName = training.sessionName
      day.discipline = training.discipline
    }
  }
```

Add `loadTrainingPlan` to the object returned at the bottom of `useMonth()` (`app/composables/useMonth.ts:92`):

```diff
-  return { days, status, loading, load, loadDaySummaries, save, confirmMonth }
+  return { days, status, loading, load, loadDaySummaries, loadTrainingPlan, save, confirmMonth }
```

- [ ] **Step 5: Wire it up in `app/pages/roster/[year]/[month].vue`**

```diff
-const { days, status, loading, load, loadDaySummaries, save, confirmMonth } = useMonth(year, month)
+const { days, status, loading, load, loadDaySummaries, loadTrainingPlan, save, confirmMonth } = useMonth(year, month)
```

```diff
 async function loadAll() {
   await load()
   await loadDaySummaries()
+  await loadTrainingPlan()
 }
```

Also add it after `onSave`/`onConfirm`'s existing `loadDaySummaries()` calls (`app/pages/roster/[year]/[month].vue:46,66`), so the badges refresh alongside the intensity badges:

```diff
     await save()
-    await loadDaySummaries() // now NO_DATA everywhere, since saving reverts the month to draft
+    await loadDaySummaries() // now NO_DATA everywhere, since saving reverts the month to draft
+    await loadTrainingPlan()
```

```diff
     overridePrompt.value = null
     status.value = 'confirmed'
     await loadDaySummaries()
+    await loadTrainingPlan()
```

- [ ] **Step 6: Manual browser verification**

Run `npm run dev`, open the roster page for a month you've already set up goals/templates for (per Task 6's curl steps), log in with the PIN. Confirm: day cells that have a prescribed session show a small icon + session name under the intensity badge; a `post_night`/no-data day shows none. Check both light content wrapping (long session names truncate with `…`, not overflow) and that draft-month tap-to-cycle still works unaffected.

- [ ] **Step 7: Commit**

```bash
git add app/components/calendar/SessionBadge.vue app/components/calendar/DayCell.vue app/components/calendar/MonthGrid.vue app/composables/useMonth.ts app/pages/roster/[year]/[month].vue
git commit -m "feat(training-plan): show prescribed session on the calendar grid"
```

---

## Task 8: Admin UI — discipline goals

**Files:**
- Create: `app/pages/admin/goals.vue`

**Interfaces:**
- Consumes: `GET /api/goals`, `PUT /api/goals` from Task 6.

- [ ] **Step 1: Create `app/pages/admin/goals.vue`**

Mirrors `app/pages/admin/shift-codes.vue` exactly in structure:

```vue
<script setup lang="ts">
interface DisciplineGoal {
  discipline: 'running' | 'swimming' | 'strength' | 'cycling'
  active: boolean
  weeklyFrequencyTarget: number
  blockLengthWeeks: number
  planStartDate: string
  baselineJson: string | null
}

const DISCIPLINE_LABELS: Record<string, string> = {
  running: 'Course à pied',
  swimming: 'Natation',
  strength: 'Musculation',
  cycling: 'Vélo (pas encore équipé)',
}
const ALL_DISCIPLINES: DisciplineGoal['discipline'][] = ['running', 'swimming', 'strength', 'cycling']

const { data, refresh } = await useFetch<DisciplineGoal[]>('/api/goals')

// One row per discipline, always all 4 shown — missing ones (no goal saved yet) get sane
// defaults locally until the user hits "Enregistrer" for that row.
const rows = computed<DisciplineGoal[]>(() => {
  const existing = new Map((data.value ?? []).map(g => [g.discipline, g]))
  return ALL_DISCIPLINES.map(discipline => existing.get(discipline) ?? {
    discipline,
    active: false,
    weeklyFrequencyTarget: 3,
    blockLengthWeeks: 4,
    planStartDate: new Date().toISOString().slice(0, 10),
    baselineJson: null,
  })
})

const saving = ref<string | null>(null)
async function saveGoal(g: DisciplineGoal) {
  saving.value = g.discipline
  try {
    await $fetch('/api/goals', { method: 'PUT', body: g })
    await refresh()
  }
  finally {
    saving.value = null
  }
}
</script>

<template>
  <main class="page">
    <h1>Objectifs par discipline</h1>
    <p class="hint">
      Le niveau de départ (allure seuil, allure/100m, charges clés) se saisit en JSON libre dans
      "Niveau de départ" — la forme est propre à chaque discipline, pas de format imposé.
    </p>

    <table>
      <thead>
        <tr>
          <th>Discipline</th><th>Actif</th><th>Séances/semaine</th><th>Semaines avant décharge</th>
          <th>Début du plan</th><th>Niveau de départ (JSON)</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in rows" :key="g.discipline">
          <td>{{ DISCIPLINE_LABELS[g.discipline] }}</td>
          <td><input v-model="g.active" type="checkbox"></td>
          <td><input v-model.number="g.weeklyFrequencyTarget" type="number" min="1"></td>
          <td><input v-model.number="g.blockLengthWeeks" type="number" min="1"></td>
          <td><input v-model="g.planStartDate" type="date"></td>
          <td><input v-model="g.baselineJson" placeholder='{"allureSeuil":"4:30/km"}'></td>
          <td>
            <button type="button" :disabled="saving === g.discipline" @click="saveGoal(g)">
              Enregistrer
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </main>
</template>

<style scoped>
.page {
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
}
.hint {
  color: #6b7280;
  font-size: 0.85rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td, th {
  border: 1px solid #e5e7eb;
  padding: 0.4rem;
  text-align: left;
}
input {
  width: 100%;
}
</style>
```

- [ ] **Step 2: Manual browser verification**

Run `npm run dev`, log in, visit `/admin/goals`. Confirm: all 4 disciplines listed even before any goal exists; toggling "Actif" + filling fields + "Enregistrer" for `running` persists (reload the page, the row still shows the saved values); `cycling` can be left `active=false`.

- [ ] **Step 3: Commit**

```bash
git add app/pages/admin/goals.vue
git commit -m "feat(training-plan): admin UI to configure discipline goals"
```

---

## Task 9: Session detail + logging panel

**Files:**
- Create: `app/components/calendar/SessionDetail.vue`
- Modify: `app/pages/roster/[year]/[month].vue`

**Interfaces:**
- Consumes: `TrainingDay` fields (`structureJson`, `sessionName`, `status`, etc. — need the full row, not just `sessionName`/`discipline` merged into `MonthDay` by Task 7) via a dedicated fetch; `POST /api/training/log` from Task 6.

- [ ] **Step 1: Fetch full training-day detail on demand**

In `app/pages/roster/[year]/[month].vue`, add state and a loader (the month-level `loadTrainingPlan()` only keeps `sessionName`/`discipline` on `MonthDay` — this fetches the one day's full detail, including `structureJson`, only when actually opened):

```typescript
const requestFetch = useRequestFetch()
const selectedTrainingDay = ref<TrainingDay | null>(null)

async function openSessionDetail(date: string) {
  const data = await requestFetch<{ days: TrainingDay[] }>(`/api/training/${year.value}/${month.value}`)
  selectedTrainingDay.value = data.days.find(d => d.date === date) ?? null
}
```

(Note: this re-fetches the whole month rather than adding a new single-day endpoint — acceptable given the payload is small (≤31 days) and the month is already being fetched elsewhere; revisit with a dedicated `GET /api/training/day/:date` only if this proves too slow in practice.)

- [ ] **Step 2: Branch the day-cell click handler on roster status**

Replace the existing `cycleCode` usage as the grid's click target. In `app/pages/roster/[year]/[month].vue`, `cycleCode` currently already no-ops when `status.value === 'confirmed'` (line 33: `if (status.value === 'confirmed') return`) — a confirmed month's cells are otherwise dead clicks today, which is exactly the hook to reuse:

```diff
-function cycleCode(date: string) {
-  if (status.value === 'confirmed') return
+function onDayClick(date: string) {
+  if (status.value === 'confirmed') {
+    openSessionDetail(date)
+    return
+  }
   const day = days.value.find(d => d.date === date)
```

```diff
     <CalendarMonthGrid
       :days="days"
       :disabled="loading"
-      @toggle="cycleCode"
+      @toggle="onDayClick"
     />
```

- [ ] **Step 3: `app/components/calendar/SessionDetail.vue`**

```vue
<script setup lang="ts">
const props = defineProps<{
  day: {
    date: string
    hasSession: boolean
    discipline?: string
    sessionName?: string
    targetIntensity?: string
    durationMinutes?: number
    structureJson?: string | null
    status?: 'planned' | 'completed' | 'skipped'
    reason?: string
  }
}>()
const emit = defineEmits<{ close: []; logged: [] }>()

const structure = computed(() => {
  if (!props.day.structureJson) return null
  try {
    return JSON.parse(props.day.structureJson) as Record<string, string>
  }
  catch {
    return null
  }
})

const rpe = ref<number | null>(null)
const duration = ref<number | null>(props.day.durationMinutes ?? null)
const notes = ref('')
const logging = ref(false)

async function log(status: 'completed' | 'skipped') {
  logging.value = true
  try {
    await $fetch('/api/training/log', {
      method: 'POST',
      body: { date: props.day.date, status, actualRpe: rpe.value, actualDurationMinutes: duration.value, notes: notes.value || null },
    })
    emit('logged')
  }
  finally {
    logging.value = false
  }
}
</script>

<template>
  <div class="detail">
    <button type="button" class="close" @click="emit('close')">
      ✕
    </button>

    <template v-if="day.hasSession">
      <h2>{{ day.sessionName }}</h2>
      <p class="meta">{{ day.discipline }} · {{ day.targetIntensity }} · {{ day.durationMinutes }} min · {{ day.status }}</p>
      <ul v-if="structure">
        <li v-for="(value, key) in structure" :key="key">
          <strong>{{ key }}</strong> : {{ value }}
        </li>
      </ul>

      <div v-if="day.status === 'planned'" class="log-form">
        <label>RPE (1-10) <input v-model.number="rpe" type="number" min="1" max="10"></label>
        <label>Durée réelle (min) <input v-model.number="duration" type="number" min="1"></label>
        <label>Notes <input v-model="notes"></label>
        <div class="actions">
          <button type="button" :disabled="logging" @click="log('completed')">
            Fait
          </button>
          <button type="button" :disabled="logging" @click="log('skipped')">
            Sauté
          </button>
        </div>
      </div>
    </template>
    <p v-else>
      Pas de séance ce jour-là{{ day.reason ? ` (${day.reason})` : '' }}.
    </p>
  </div>
</template>

<style scoped>
.detail {
  margin-top: 1rem;
  padding: 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  position: relative;
}
.close {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
}
.meta {
  color: #6b7280;
  font-size: 0.85rem;
}
.log-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.75rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
}
</style>
```

- [ ] **Step 4: Render it in the roster page**

```diff
     <CalendarMonthGrid
       :days="days"
       :disabled="loading"
       @toggle="onDayClick"
     />

+    <CalendarSessionDetail
+      v-if="selectedTrainingDay"
+      :day="selectedTrainingDay"
+      @close="selectedTrainingDay = null"
+      @logged="async () => { await openSessionDetail(selectedTrainingDay!.date); await loadTrainingPlan() }"
+    />
```

- [ ] **Step 5: Manual browser verification**

Run `npm run dev`, log in, open a confirmed month with prescribed sessions. Click a day cell: the detail panel opens showing the session name, structure, and (for a `planned` session) the log form. Submit "Fait" with an RPE/duration — confirm the panel updates to `status: completed` and the log form disappears; reopening the same day later still shows the same session (not re-picked). Click a day with no session: confirm the "Pas de séance" message with its reason. Confirm draft-month behavior (tap-to-cycle) is unaffected.

- [ ] **Step 6: Commit**

```bash
git add app/components/calendar/SessionDetail.vue app/pages/roster/[year]/[month].vue
git commit -m "feat(training-plan): session detail view and manual completion logging"
```

---

## Self-Review Notes

- **Spec coverage:** ingestion decision (documented, no task needed) · discipline model + goals table → Task 1 · computed periodization → Task 3 · time window → Task 2 · prescription algorithm (priority, template matching, fallback, variety, determinism) → Task 4 · persistence rule (never overwrite logged) → Task 4 · seed library → Task 5 · admin baseline entry → Task 8 · calendar display → Task 7 · manual logging loop → Task 6 + Task 9 · all "Cas limites" bullets map to specific test cases in Tasks 3-4 or to existing `dayType.ts` behavior reused unchanged.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or exact commands with expected output.
- **Type consistency:** `Discipline`, `PlanPhase`, `DisciplineProgress`, `AvailableWindow`, `Prescription` are defined once (Tasks 2-4) and reused verbatim by name in Tasks 6-9's TypeScript interfaces (`TrainingDay`, component props). `INTENSITY_ORDER`/`IntensityLevel` are exported once (Task 4, Step 1) and consumed only via that export.

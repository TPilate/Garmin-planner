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

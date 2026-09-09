import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~~/db/client'
import { ensurePlannedSession, getAvailableWindow, getDailyPrescription, getDisciplineProgress, NO_SHIFT_MINUTES } from '../server/utils/trainingPlan'
import { addDisciplineGoal, addLoggedSession, addSessionTemplate, addShift, confirmMonth, resetTables, seedShiftCodes, TEST_TZ } from './helpers'

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

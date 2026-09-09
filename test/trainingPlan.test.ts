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

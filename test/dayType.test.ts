import { beforeEach, describe, expect, it } from 'vitest'
import { getDaySummary } from '../server/utils/dayType'
import { addGarmin, addLeave, addShift, addShiftWithRawCategory, confirmMonth, resetTables, seedShiftCodes, TEST_TZ } from './helpers'

beforeEach(async () => {
  await resetTables()
  await seedShiftCodes()
})

describe('getDaySummary — guards against silent failure', () => {
  it('returns NO_DATA when the month has never been entered', async () => {
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('no_data')
    expect(summary.intensityCeiling).toBeNull()
  })

  it('returns NO_DATA when the month exists only as a draft, never confirmed', async () => {
    await confirmMonth(2026, 9, 'draft')
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('no_data')
  })

  it('returns NO_DATA on day 1 of a confirmed month if the previous month is unconfirmed (cross-month boundary)', async () => {
    await confirmMonth(2026, 10) // October confirmed, September is not
    const summary = await getDaySummary('2026-10-01', TEST_TZ)
    expect(summary.dayType).toBe('no_data')
    expect(summary.reason).toMatch(/previous day/)
  })
})

describe('getDaySummary — day types', () => {
  it('OFF: no shift, no leave -> ceiling HARD', async () => {
    await confirmMonth(2026, 9)
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('off')
    expect(summary.intensityCeiling).toBe('hard')
    expect(summary.metricsDegraded).toBe(false)
  })

  it('HALF (1/2): home ~15:00 -> ceiling HARD (time-constrained, not physiologically capped)', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', '1/2', rm.id)
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('half')
    expect(summary.intensityCeiling).toBe('hard')
  })

  it('LONG_DAY (J): 13h door-to-door -> ceiling MOBILITY', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', 'J', rm.id)
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('long_day')
    expect(summary.intensityCeiling).toBe('mobility')
  })

  it('PRE_NIGHT (N starting today) -> degraded, ceiling MODERATE, Garmin ignored even if it looks great', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-15', 'N', rm.id)
    await addGarmin('2026-09-15', 45, 90) // an excellent reading — must still be ignored
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('pre_night')
    expect(summary.metricsDegraded).toBe(true)
    expect(summary.intensityCeiling).toBe('moderate')
    expect(summary.garminUsed).toBe(false)
  })

  it('POST_NIGHT: an N shift ended this morning -> hard-coded REST, no exceptions', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-14', 'N', rm.id) // ends 2026-09-15 08:00 local (crosses midnight)
    await addGarmin('2026-09-15', 45, 90) // an excellent reading — must still be ignored
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('post_night')
    expect(summary.metricsDegraded).toBe(true)
    expect(summary.intensityCeiling).toBe('rest')
    expect(summary.garminUsed).toBe(false)
  })

  it('back-to-back nights: POST_NIGHT still wins even though today also starts a fresh N tonight', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShift('2026-09-14', 'N', rm.id) // ends this morning
    await addShift('2026-09-15', 'N', rm.id) // starts again tonight
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('post_night')
    expect(summary.intensityCeiling).toBe('rest')
  })

  it('LEAVE: an empty day tagged as leave -> ceiling HARD, distinct from a plain OFF day', async () => {
    await confirmMonth(2026, 9)
    await addLeave('2026-09-10', '2026-09-16')
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('leave')
    expect(summary.intensityCeiling).toBe('hard')
  })

  it('UNKNOWN shift_codes.category fails safe to REST rather than guessing', async () => {
    const rm = await confirmMonth(2026, 9)
    await addShiftWithRawCategory('2026-09-15', 'ONCALL', 'on_call_24h', rm.id)
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('unknown')
    expect(summary.intensityCeiling).toBe('rest')
  })
})

describe('getDaySummary — Garmin baseline adjustment (non-degraded days only)', () => {
  // 28 days ending the day before asOfDate, cycling through the given values so the resulting
  // median/IQR are deterministic and hand-verifiable.
  async function seedBaseline(restingHrCycle: number[], hrvCycle: number[]) {
    for (let i = 28; i >= 1; i--) {
      const d = new Date(2026, 8, 15 - i)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const index = 28 - i
      await addGarmin(date, restingHrCycle[index % restingHrCycle.length], hrvCycle[index % hrvCycle.length])
    }
  }

  it('falls back to the shift-only ceiling when there is no Garmin sync data for the date', async () => {
    await confirmMonth(2026, 9)
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.garminUsed).toBe(false)
    expect(summary.intensityCeiling).toBe('hard')
    expect(summary.reason).toMatch(/no Garmin/)
  })

  it('OFF day with resting HR clearly above baseline (>1 IQR) -> ceiling drops one notch', async () => {
    await confirmMonth(2026, 9)
    await confirmMonth(2026, 8)
    await seedBaseline([48, 49, 50, 51, 52], [70, 72, 75, 78, 80]) // median RHR 50 (IQR 2), median HRV 75 (IQR 6)
    await addGarmin('2026-09-15', 70, 75) // RHR far above baseline, HRV right at baseline median
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('off')
    expect(summary.garminUsed).toBe(true)
    expect(summary.intensityCeiling).toBe('moderate') // hard, one notch down
  })

  it('OFF day with both resting HR and HRV strongly abnormal (>1.5 IQR each) -> ceiling drops two notches', async () => {
    await confirmMonth(2026, 9)
    await confirmMonth(2026, 8)
    await seedBaseline([48, 49, 50, 51, 52], [70, 72, 75, 78, 80])
    await addGarmin('2026-09-15', 90, 40) // RHR far above, HRV far below baseline
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.intensityCeiling).toBe('easy') // hard, two notches down
  })

  it('LONG_DAY never drops below the MOBILITY floor even with a strongly abnormal Garmin reading', async () => {
    const rm = await confirmMonth(2026, 9)
    await confirmMonth(2026, 8)
    await seedBaseline([48, 49, 50, 51, 52], [70, 72, 75, 78, 80])
    await addShift('2026-09-15', 'J', rm.id)
    await addGarmin('2026-09-15', 90, 40)
    const summary = await getDaySummary('2026-09-15', TEST_TZ)
    expect(summary.dayType).toBe('long_day')
    expect(summary.intensityCeiling).toBe('mobility')
  })
})

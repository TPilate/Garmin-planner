import { db } from './client'
import { shiftCodes } from './schema'

// Shift codes are user-editable in production via the admin screen — this seed only bootstraps
// the three codes documented in the roster brief so the app is usable on first run.
const SEED_CODES = [
  {
    code: 'J',
    label: 'Jour long',
    startTime: '07:00',
    endTime: '20:00',
    crossesMidnight: false,
    durationMinutes: 13 * 60,
    category: 'long_day' as const,
  },
  {
    code: 'N',
    label: 'Nuit',
    startTime: '20:00',
    endTime: '08:00',
    crossesMidnight: true,
    durationMinutes: 12 * 60,
    category: 'night' as const,
  },
  {
    code: '1/2',
    label: 'Demi-journée',
    startTime: '07:00',
    endTime: '14:00',
    crossesMidnight: false,
    durationMinutes: 7 * 60,
    category: 'half_day' as const,
  },
]

async function main() {
  for (const c of SEED_CODES) {
    await db.insert(shiftCodes).values(c).onConflictDoNothing()
  }
  console.log(`Seeded ${SEED_CODES.length} shift codes.`)
}

main()

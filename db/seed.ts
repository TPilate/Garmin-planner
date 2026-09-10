import { db } from './client'
import { sessionTemplates, shiftCodes } from './schema'

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

async function main() {
  for (const c of SEED_CODES) {
    await db.insert(shiftCodes).values(c).onConflictDoNothing()
  }
  console.log(`Seeded ${SEED_CODES.length} shift codes.`)
  await seedSessionTemplates()
}

main()

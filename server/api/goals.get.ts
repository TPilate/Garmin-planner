import { asc } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { disciplineGoals } from '~~/db/schema'
import type { Discipline } from '../utils/trainingPlan'

// Attaches the current computed block/week/phase to each active goal, for the Objectifs
// screen's "position dans le cycle" display — read-only enrichment, never written back.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const today = DateTime.now().setZone(config.appTimezone).toISODate()!

  const goals = await db.select().from(disciplineGoals).orderBy(asc(disciplineGoals.discipline))

  return Promise.all(goals.map(async (goal) => {
    if (!goal.active) return { ...goal, progress: null }
    const progress = await getDisciplineProgress(goal.discipline as Discipline, today)
    return {
      ...goal,
      progress: progress
        ? { blockNumber: progress.blockNumber, weekInBlock: progress.weekInBlock, phase: progress.phase }
        : null,
    }
  }))
})

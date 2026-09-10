import { asc } from 'drizzle-orm'
import { disciplineGoals } from '~~/db/schema'

export default defineEventHandler(async () => {
  return db.select().from(disciplineGoals).orderBy(asc(disciplineGoals.discipline))
})

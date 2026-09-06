import { asc } from 'drizzle-orm'
import { shiftCodes } from '~~/db/schema'

export default defineEventHandler(async () => {
  return db.select().from(shiftCodes).orderBy(asc(shiftCodes.code))
})

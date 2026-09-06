import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { rosterMonths } from './shifts'

// Phase 5 (not wired to any UI yet). Exists now so the manual-entry data model never needs a
// breaking migration to accommodate OCR pre-fill later. The vision model only ever returns
// {day, rawCode} pairs (parsedPairs) — code-to-hours resolution happens in app code against
// shift_codes, never inside the model prompt. Both the image and the raw model response are
// preserved so a bad parse can be reprocessed locally without re-uploading or re-querying.
export const ocrUploads = sqliteTable(
  'ocr_uploads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    rosterMonthId: integer('roster_month_id')
      .notNull()
      .references(() => rosterMonths.id, { onDelete: 'cascade' }),
    imagePath: text('image_path').notNull(), // stored on disk/object storage, not as a DB blob
    imageSha256: text('image_sha256').notNull(),
    rawModelResponse: text('raw_model_response').notNull(),
    parsedPairs: text('parsed_pairs').notNull(), // JSON: [{day, rawCode}]
    status: text('status', { enum: ['pending', 'processed', 'flagged', 'rejected'] })
      .notNull()
      .default('pending'),
    plausibilityCheck: text('plausibility_check'),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => ({
    monthIdx: index('ocr_uploads_month_idx').on(t.rosterMonthId),
  }),
)

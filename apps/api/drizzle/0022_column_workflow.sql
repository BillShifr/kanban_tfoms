ALTER TABLE "columns"
  ADD COLUMN "is_completion" boolean NOT NULL DEFAULT false;

-- Preserve the behavior of existing boards: before this migration the last
-- active column was implicitly treated as completed. The explicit marker
-- separates that business rule from the visual order from now on.
WITH terminal_columns AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY board_id
           ORDER BY position DESC, created_at DESC, id DESC
         ) AS rank
  FROM "columns"
  WHERE archived_at IS NULL
)
UPDATE "columns" AS target
SET is_completion = true
FROM terminal_columns
WHERE target.id = terminal_columns.id
  AND terminal_columns.rank = 1;

CREATE UNIQUE INDEX "columns_one_active_completion_idx"
  ON "columns" (board_id)
  WHERE archived_at IS NULL AND is_completion;

ALTER TABLE "columns"
  ADD CONSTRAINT "columns_archived_not_completion"
  CHECK (archived_at IS NULL OR NOT is_completion);

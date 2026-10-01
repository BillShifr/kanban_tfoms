CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY,
  "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "column_id" uuid NOT NULL REFERENCES "columns"("id") ON DELETE RESTRICT,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "position" numeric NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "archived_at" timestamptz
);
CREATE INDEX "tasks_board_active_idx" ON "tasks" ("board_id", "archived_at");
CREATE INDEX "tasks_column_position_idx" ON "tasks" ("column_id", "archived_at", "position");

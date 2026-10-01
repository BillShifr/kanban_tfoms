CREATE TABLE "time_entry_corrections" (
  "id" uuid PRIMARY KEY,
  "time_entry_id" uuid NOT NULL REFERENCES "time_entries"("id") ON DELETE RESTRICT,
  "corrected_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "previous_started_at" timestamptz NOT NULL,
  "previous_stopped_at" timestamptz NOT NULL,
  "started_at" timestamptz NOT NULL,
  "stopped_at" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("stopped_at" >= "started_at")
);
CREATE INDEX "time_entry_corrections_entry_idx" ON "time_entry_corrections" ("time_entry_id", "created_at");

CREATE TYPE "task_event_type" AS ENUM ('created', 'column_changed', 'assignee_changed');

CREATE TABLE "task_events" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "type" "task_event_type" NOT NULL,
  "from_column_id" uuid,
  "from_column_name" text,
  "to_column_id" uuid,
  "to_column_name" text,
  "from_assignee_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "to_assignee_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "task_events_shape_check" CHECK (
    ("type" = 'created' AND "from_column_id" IS NULL AND "from_column_name" IS NULL AND "to_column_id" IS NULL AND "to_column_name" IS NULL AND "from_assignee_id" IS NULL AND "to_assignee_id" IS NULL)
    OR
    ("type" = 'column_changed' AND "from_column_id" IS NOT NULL AND "from_column_name" IS NOT NULL AND "to_column_id" IS NOT NULL AND "to_column_name" IS NOT NULL AND "from_column_id" <> "to_column_id" AND "from_assignee_id" IS NULL AND "to_assignee_id" IS NULL)
    OR
    ("type" = 'assignee_changed' AND "from_column_id" IS NULL AND "from_column_name" IS NULL AND "to_column_id" IS NULL AND "to_column_name" IS NULL AND "from_assignee_id" IS DISTINCT FROM "to_assignee_id")
  )
);

CREATE INDEX "task_events_task_created_idx" ON "task_events" ("task_id", "created_at" DESC, "id" DESC);

INSERT INTO "task_events" ("id", "task_id", "actor_id", "type", "created_at")
SELECT gen_random_uuid(), "id", "author_id", 'created', "created_at"
FROM "tasks";

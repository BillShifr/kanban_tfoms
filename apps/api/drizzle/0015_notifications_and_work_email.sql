ALTER TABLE "users" ADD COLUMN "work_email" text;
UPDATE "users" SET "work_email" = "email" WHERE "work_email" IS NULL;

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "task_title" text NOT NULL,
  "type" text NOT NULL,
  "read_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_type_check" CHECK ("type" = 'task_assigned')
);
CREATE INDEX "notifications_user_unread_idx"
  ON "notifications" ("user_id", "read_at", "created_at" DESC);

ALTER TABLE "task_events" DROP CONSTRAINT "task_events_shape_check";
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_shape_check" CHECK (
  ("type" = 'created'
    AND "from_column_id" IS NULL AND "from_column_name" IS NULL
    AND "to_column_id" IS NULL AND "to_column_name" IS NULL
    AND "from_assignee_id" IS NULL AND "from_assignee_name" IS NULL
    AND "to_assignee_id" IS NULL AND "to_assignee_name" IS NULL)
  OR
  ("type" = 'completed'
    AND "from_column_id" IS NULL AND "from_column_name" IS NULL
    AND "to_column_id" IS NULL AND "to_column_name" IS NULL
    AND "from_assignee_id" IS NULL AND "from_assignee_name" IS NULL
    AND "to_assignee_id" IS NULL AND "to_assignee_name" IS NULL)
  OR
  ("type" = 'column_changed'
    AND "from_column_id" IS NOT NULL AND "from_column_name" IS NOT NULL
    AND "to_column_id" IS NOT NULL AND "to_column_name" IS NOT NULL
    AND "from_column_id" <> "to_column_id"
    AND "from_assignee_id" IS NULL AND "from_assignee_name" IS NULL
    AND "to_assignee_id" IS NULL AND "to_assignee_name" IS NULL)
  OR
  ("type" = 'assignee_changed'
    AND "from_column_id" IS NULL AND "from_column_name" IS NULL
    AND "to_column_id" IS NULL AND "to_column_name" IS NULL
    AND NOT ("from_assignee_id" IS NOT NULL AND "from_assignee_name" IS NOT NULL)
    AND NOT ("to_assignee_id" IS NOT NULL AND "to_assignee_name" IS NOT NULL)
    AND ROW("from_assignee_id", "from_assignee_name")
      IS DISTINCT FROM ROW("to_assignee_id", "to_assignee_name"))
);

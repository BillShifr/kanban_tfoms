CREATE TABLE "departments" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "departments_name_check" CHECK (
    "name" = btrim("name") AND char_length("name") BETWEEN 1 AND 120
  )
);

CREATE UNIQUE INDEX "departments_name_ci_idx"
  ON "departments" (lower("name"));

INSERT INTO "departments" ("id", "name")
VALUES (gen_random_uuid(), 'Общий отдел');

ALTER TABLE "boards" ADD COLUMN "department_id" uuid;
UPDATE "boards"
SET "department_id" = (
  SELECT "id" FROM "departments" WHERE "name" = 'Общий отдел'
);
ALTER TABLE "boards" ALTER COLUMN "department_id" SET NOT NULL;
ALTER TABLE "boards"
  ADD CONSTRAINT "boards_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT;
CREATE INDEX "boards_department_idx" ON "boards" ("department_id");

CREATE OR REPLACE FUNCTION kanban_valid_assignee_name(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT candidate IS NOT NULL
    AND candidate = btrim(candidate)
    AND char_length(candidate) BETWEEN 1 AND 120
    AND candidate !~ '[[:cntrl:]]'
    AND translate(
      candidate,
      chr(1564) || chr(8206) || chr(8207) ||
      chr(8234) || chr(8235) || chr(8236) || chr(8237) || chr(8238) ||
      chr(8294) || chr(8295) || chr(8296) || chr(8297),
      ''
    ) = candidate
$$;

ALTER TABLE "tasks" ADD COLUMN "assignee_name" text;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_assignee_shape_check" CHECK (
    NOT ("assignee_id" IS NOT NULL AND "assignee_name" IS NOT NULL)
    AND (
      "assignee_name" IS NULL
      OR kanban_valid_assignee_name("assignee_name")
    )
  );

ALTER TABLE "task_events"
  ADD COLUMN "from_assignee_name" text,
  ADD COLUMN "to_assignee_name" text;

ALTER TABLE "task_events" DROP CONSTRAINT "task_events_shape_check";

ALTER TABLE "task_events"
  ADD CONSTRAINT "task_events_assignee_names_check" CHECK (
    ("from_assignee_name" IS NULL OR kanban_valid_assignee_name("from_assignee_name"))
    AND
    ("to_assignee_name" IS NULL OR kanban_valid_assignee_name("to_assignee_name"))
  );

ALTER TABLE "task_events"
  ADD CONSTRAINT "task_events_shape_check" CHECK (
    (
      "type" = 'created'
      AND "from_column_id" IS NULL
      AND "from_column_name" IS NULL
      AND "to_column_id" IS NULL
      AND "to_column_name" IS NULL
      AND "from_assignee_id" IS NULL
      AND "from_assignee_name" IS NULL
      AND "to_assignee_id" IS NULL
      AND "to_assignee_name" IS NULL
    )
    OR
    (
      "type" = 'column_changed'
      AND "from_column_id" IS NOT NULL
      AND "from_column_name" IS NOT NULL
      AND "to_column_id" IS NOT NULL
      AND "to_column_name" IS NOT NULL
      AND "from_column_id" <> "to_column_id"
      AND "from_assignee_id" IS NULL
      AND "from_assignee_name" IS NULL
      AND "to_assignee_id" IS NULL
      AND "to_assignee_name" IS NULL
    )
    OR
    (
      "type" = 'assignee_changed'
      AND "from_column_id" IS NULL
      AND "from_column_name" IS NULL
      AND "to_column_id" IS NULL
      AND "to_column_name" IS NULL
      AND NOT (
        "from_assignee_id" IS NOT NULL
        AND "from_assignee_name" IS NOT NULL
      )
      AND NOT (
        "to_assignee_id" IS NOT NULL
        AND "to_assignee_name" IS NOT NULL
      )
      AND ROW("from_assignee_id", "from_assignee_name")
        IS DISTINCT FROM ROW("to_assignee_id", "to_assignee_name")
    )
  );

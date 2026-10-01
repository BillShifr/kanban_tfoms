CREATE TABLE "topics" (
  "id" uuid PRIMARY KEY,
  "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
CREATE UNIQUE INDEX "topics_board_name_active_idx" ON "topics" ("board_id", "name");

CREATE TABLE "labels" (
  "id" uuid PRIMARY KEY,
  "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
CREATE UNIQUE INDEX "labels_board_name_active_idx" ON "labels" ("board_id", "name");

ALTER TABLE "tasks"
  ADD COLUMN "assignee_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD COLUMN "topic_id" uuid REFERENCES "topics"("id") ON DELETE RESTRICT,
  ADD COLUMN "color" text,
  ADD COLUMN "due_at" timestamptz,
  ADD COLUMN "estimated_minutes" integer CHECK ("estimated_minutes" >= 0);
CREATE INDEX "tasks_assignee_idx" ON "tasks" ("board_id", "assignee_id");

CREATE TABLE "task_labels" (
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "label_id" uuid NOT NULL REFERENCES "labels"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("task_id", "label_id")
);

CREATE TABLE "time_entries" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE RESTRICT,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "started_at" timestamptz NOT NULL,
  "stopped_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("stopped_at" IS NULL OR "stopped_at" >= "started_at")
);
CREATE INDEX "time_entries_task_started_idx" ON "time_entries" ("task_id", "started_at");
CREATE INDEX "time_entries_user_started_idx" ON "time_entries" ("user_id", "started_at");
CREATE UNIQUE INDEX "time_entries_one_active_per_user_idx" ON "time_entries" ("user_id") WHERE "stopped_at" IS NULL;

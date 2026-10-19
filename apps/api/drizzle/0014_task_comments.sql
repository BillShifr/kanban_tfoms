CREATE TABLE "task_comments" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "task_comments_body_check" CHECK (
    "body" = btrim("body")
    AND char_length("body") BETWEEN 1 AND 4000
  )
);

CREATE INDEX "task_comments_task_created_idx"
  ON "task_comments" ("task_id", "created_at", "id");

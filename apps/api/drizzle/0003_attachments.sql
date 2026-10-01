CREATE TABLE "attachments" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
  "storage_path" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "attachments_task_idx" ON "attachments" ("task_id", "created_at");

ALTER TABLE "users"
  ADD COLUMN "first_name" text,
  ADD COLUMN "last_name" text,
  ADD CONSTRAINT "users_first_name_check"
    CHECK (
      "first_name" IS NULL OR (
        "first_name" = btrim("first_name")
        AND char_length("first_name") BETWEEN 1 AND 80
      )
    ),
  ADD CONSTRAINT "users_last_name_check"
    CHECK (
      "last_name" IS NULL OR (
        "last_name" = btrim("last_name")
        AND char_length("last_name") BETWEEN 1 AND 80
      )
    );

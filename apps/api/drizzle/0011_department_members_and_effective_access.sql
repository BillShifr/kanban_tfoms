CREATE TABLE "department_members" (
  "department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("department_id", "user_id")
);
CREATE INDEX "department_members_user_idx"
  ON "department_members" ("user_id", "department_id");

-- This is deliberately separate from the enum migration: PostgreSQL does not
-- allow a newly added enum value to be used until that migration commits.
UPDATE "users" SET "role" = 'superadmin' WHERE "role" = 'admin';
DELETE FROM "board_members" bm
USING "users" u
WHERE bm."user_id" = u."id" AND u."role" <> 'user';

CREATE OR REPLACE FUNCTION kanban_has_board_access(
  required_board_id uuid,
  required_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM boards b
    JOIN users u ON u.id = required_user_id
    WHERE b.id = required_board_id
      AND b.archived_at IS NULL
      AND u.archived_at IS NULL
      AND (
        u.role IN ('superadmin'::user_role, 'admin'::user_role)
        OR EXISTS (
          SELECT 1 FROM board_members bm
          WHERE bm.board_id = b.id AND bm.user_id = u.id
        )
        OR EXISTS (
          SELECT 1 FROM department_members dm
          WHERE dm.department_id = b.department_id AND dm.user_id = u.id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION kanban_require_board_member(
  required_board_id uuid,
  required_user_id uuid,
  relation_name text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT kanban_has_board_access(required_board_id, required_user_id) THEN
    RAISE EXCEPTION '% must reference a user with board access', relation_name
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION kanban_validate_assignment_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND role = 'user' AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'assignments require an active user account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER board_members_validate_assignment_target
BEFORE INSERT OR UPDATE ON board_members
FOR EACH ROW EXECUTE FUNCTION kanban_validate_assignment_target();

CREATE TRIGGER department_members_validate_assignment_target
BEFORE INSERT OR UPDATE ON department_members
FOR EACH ROW EXECUTE FUNCTION kanban_validate_assignment_target();

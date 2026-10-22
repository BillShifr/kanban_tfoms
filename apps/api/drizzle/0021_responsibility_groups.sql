CREATE TABLE "responsibility_groups" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "department_id" uuid NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT,
  "responsible_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "responsibility_groups_name_check"
    CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX "responsibility_groups_department_name_ci_idx"
  ON "responsibility_groups"("department_id", lower("name"));
CREATE INDEX "responsibility_groups_responsible_idx"
  ON "responsibility_groups"("responsible_id", "department_id");

CREATE TABLE "responsibility_group_members" (
  "group_id" uuid NOT NULL REFERENCES "responsibility_groups"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("group_id", "user_id")
);

CREATE INDEX "responsibility_group_members_user_idx"
  ON "responsibility_group_members"("user_id", "group_id");

-- A responsible manager needs ordinary board/department membership to work in
-- the department they supervise. Global admins remain excluded because their
-- access is implicit and must not be represented by assignment rows.
CREATE OR REPLACE FUNCTION kanban_validate_assignment_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id
      AND role IN ('user', 'manager')
      AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'assignments require an active user or manager account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION kanban_validate_responsibility_group()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.responsible_id
      AND role = 'manager'
      AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'responsible user must be an active manager'
      USING ERRCODE = '23514', CONSTRAINT = 'responsibility_group_responsible_check';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER responsibility_group_responsible_check
BEFORE INSERT OR UPDATE OF responsible_id ON responsibility_groups
FOR EACH ROW EXECUTE FUNCTION kanban_validate_responsibility_group();

CREATE FUNCTION kanban_validate_responsibility_group_member()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM responsibility_groups
    WHERE id = NEW.group_id AND responsible_id = NEW.user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id
      AND role <> 'superadmin'
      AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'group member must be an active non-superadmin employee'
      USING ERRCODE = '23514', CONSTRAINT = 'responsibility_group_member_check';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER responsibility_group_member_check
BEFORE INSERT OR UPDATE ON responsibility_group_members
FOR EACH ROW EXECUTE FUNCTION kanban_validate_responsibility_group_member();

CREATE FUNCTION kanban_protect_responsibility_roles()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'manager' AND NEW.role <> 'manager' AND EXISTS (
    SELECT 1 FROM responsibility_groups WHERE responsible_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'responsible manager role cannot be changed while groups exist'
      USING ERRCODE = '23514', CONSTRAINT = 'responsibility_manager_role_check';
  END IF;
  IF NEW.archived_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM responsibility_groups WHERE responsible_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'responsible manager cannot be archived while groups exist'
      USING ERRCODE = '23514', CONSTRAINT = 'responsibility_manager_active_check';
  END IF;
  IF NEW.role = 'superadmin' AND EXISTS (
    SELECT 1 FROM responsibility_group_members WHERE user_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'group member cannot become superadmin'
      USING ERRCODE = '23514', CONSTRAINT = 'responsibility_member_role_check';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER responsibility_user_role_check
BEFORE UPDATE OF role, archived_at ON users
FOR EACH ROW EXECUTE FUNCTION kanban_protect_responsibility_roles();

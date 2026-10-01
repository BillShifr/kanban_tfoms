-- Preserve existing rows while enforcing these constraints for all new writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'columns_position_positive'
  ) THEN
    EXECUTE 'ALTER TABLE columns ADD CONSTRAINT columns_position_positive CHECK (position > 0) NOT VALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_position_positive'
  ) THEN
    EXECUTE 'ALTER TABLE tasks ADD CONSTRAINT tasks_position_positive CHECK (position > 0) NOT VALID';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION kanban_require_board_member(
  required_board_id uuid,
  required_user_id uuid,
  relation_name text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM board_members
    WHERE board_id = required_board_id AND user_id = required_user_id
  ) THEN
    RAISE EXCEPTION '% must reference a current board member', relation_name
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION kanban_validate_task_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_board_id uuid;
BEGIN
  SELECT board_id INTO linked_board_id FROM columns WHERE id = NEW.column_id;
  IF NOT FOUND OR linked_board_id IS DISTINCT FROM NEW.board_id THEN
    RAISE EXCEPTION 'task column must belong to its board' USING ERRCODE = '23514';
  END IF;

  IF NEW.topic_id IS NOT NULL THEN
    SELECT board_id INTO linked_board_id FROM topics WHERE id = NEW.topic_id;
    IF NOT FOUND OR linked_board_id IS DISTINCT FROM NEW.board_id THEN
      RAISE EXCEPTION 'task topic must belong to its board' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Authors remain historical attribution after they leave a board. Require
  -- membership when the attribution is first written or explicitly changed,
  -- without making every later task edit depend on former membership.
  IF TG_OP = 'INSERT'
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.board_id IS DISTINCT FROM OLD.board_id THEN
    PERFORM kanban_require_board_member(NEW.board_id, NEW.author_id, 'task author');
  END IF;
  IF NEW.assignee_id IS NOT NULL THEN
    PERFORM kanban_require_board_member(NEW.board_id, NEW.assignee_id, 'task assignee');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kanban_validate_task_label_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_board_id uuid;
  label_board_id uuid;
BEGIN
  SELECT board_id INTO task_board_id FROM tasks WHERE id = NEW.task_id;
  SELECT board_id INTO label_board_id FROM labels WHERE id = NEW.label_id;
  IF task_board_id IS NULL OR label_board_id IS NULL
    OR task_board_id IS DISTINCT FROM label_board_id THEN
    RAISE EXCEPTION 'task label must belong to the task board' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kanban_validate_time_entry_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_board_id uuid;
BEGIN
  SELECT board_id INTO task_board_id FROM tasks WHERE id = NEW.task_id;
  IF task_board_id IS NULL THEN
    RAISE EXCEPTION 'time entry task must exist' USING ERRCODE = '23514';
  END IF;
  PERFORM kanban_require_board_member(task_board_id, NEW.user_id, 'time entry user');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kanban_validate_attachment_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_board_id uuid;
BEGIN
  SELECT board_id INTO task_board_id FROM tasks WHERE id = NEW.task_id;
  IF task_board_id IS NULL THEN
    RAISE EXCEPTION 'attachment task must exist' USING ERRCODE = '23514';
  END IF;
  PERFORM kanban_require_board_member(task_board_id, NEW.uploaded_by, 'attachment uploader');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kanban_validate_task_event_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_board_id uuid;
BEGIN
  SELECT board_id INTO task_board_id FROM tasks WHERE id = NEW.task_id;
  IF task_board_id IS NULL THEN
    RAISE EXCEPTION 'task event task must exist' USING ERRCODE = '23514';
  END IF;
  PERFORM kanban_require_board_member(task_board_id, NEW.actor_id, 'task event actor');
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_validate_board_links_and_membership
BEFORE INSERT OR UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION kanban_validate_task_invariants();

CREATE TRIGGER task_labels_validate_board_link
BEFORE INSERT OR UPDATE ON task_labels
FOR EACH ROW EXECUTE FUNCTION kanban_validate_task_label_invariant();

CREATE TRIGGER time_entries_validate_membership
BEFORE INSERT OR UPDATE ON time_entries
FOR EACH ROW EXECUTE FUNCTION kanban_validate_time_entry_membership();

CREATE TRIGGER attachments_validate_membership
BEFORE INSERT OR UPDATE ON attachments
FOR EACH ROW EXECUTE FUNCTION kanban_validate_attachment_membership();

CREATE TRIGGER task_events_validate_membership
BEFORE INSERT OR UPDATE ON task_events
FOR EACH ROW EXECUTE FUNCTION kanban_validate_task_event_membership();

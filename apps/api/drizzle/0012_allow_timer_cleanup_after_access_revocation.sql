CREATE OR REPLACE FUNCTION kanban_validate_time_entry_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  task_board_id uuid;
BEGIN
  -- Access is required when a time entry is created or reassigned. A later
  -- access revocation must still be able to close an already running timer.
  IF TG_OP = 'INSERT'
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    SELECT board_id INTO task_board_id FROM tasks WHERE id = NEW.task_id;
    IF task_board_id IS NULL THEN
      RAISE EXCEPTION 'time entry task must exist' USING ERRCODE = '23514';
    END IF;
    PERFORM kanban_require_board_member(
      task_board_id,
      NEW.user_id,
      'time entry user'
    );
  END IF;
  RETURN NEW;
END;
$$;

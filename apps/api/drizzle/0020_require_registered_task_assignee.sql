ALTER TABLE tasks
  ADD COLUMN assignee_required boolean NOT NULL DEFAULT true;

-- Existing tasks remain editable even when their original assignee is absent or
-- stored only as free text. Every task inserted after this migration uses the
-- default above and must keep a registered account assigned.
UPDATE tasks SET assignee_required = false;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_registered_assignee_required CHECK (
    NOT assignee_required
    OR (assignee_id IS NOT NULL AND assignee_name IS NULL)
  );

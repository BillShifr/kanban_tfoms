CREATE TABLE task_acknowledgements (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX task_acknowledgements_task_recent_idx
  ON task_acknowledgements (task_id, acknowledged_at DESC);

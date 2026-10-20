CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 240),
  avatar bytea CHECK (octet_length(avatar) <= 524288),
  avatar_type text CHECK (avatar_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CHECK ((avatar IS NULL) = (avatar_type IS NULL))
);

-- No historical backfill: points start at deployment, not at an invented date.
CREATE TABLE contribution_events (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('created', 'completed')),
  points integer NOT NULL CHECK ((kind = 'created' AND points = 2) OR (kind = 'completed' AND points = 10)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, kind)
);
CREATE INDEX contribution_events_user_date ON contribution_events(user_id, created_at);

CREATE FUNCTION record_task_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO contribution_events(task_id, user_id, kind, points)
    VALUES (NEW.id, NEW.author_id, 'created', 2);
  END IF;
  IF NEW.completed_at IS NOT NULL AND NEW.assignee_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR OLD.completed_at IS NULL THEN
      INSERT INTO contribution_events(task_id, user_id, kind, points)
      VALUES (NEW.id, NEW.assignee_id, 'completed', 10)
      ON CONFLICT (task_id, kind) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_contribution AFTER INSERT OR UPDATE OF completed_at ON tasks
FOR EACH ROW EXECUTE FUNCTION record_task_contribution();

-- Collections persist; monthly scores still use the existing reversible ledger.
CREATE TABLE earned_achievements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code IN ('initiative','navigator','architect','result','bridge','constellation','summit','orbit')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
ALTER TABLE user_profiles ADD COLUMN selected_frame text NOT NULL DEFAULT 'none'
  CHECK (selected_frame IN ('none','trail','bridge','summit','nova','prism','tide'));
CREATE TABLE reward_seasons (
  period date PRIMARY KEY,
  finalized_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE monthly_rewards (
  period date NOT NULL REFERENCES reward_seasons(period),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place integer NOT NULL CHECK (place BETWEEN 1 AND 3),
  points integer NOT NULL CHECK (points > 0),
  completed integer NOT NULL CHECK (completed > 0),
  PRIMARY KEY (period,user_id)
);
-- Do not invent results for months before this feature was deployed.
CREATE TABLE reward_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_period date NOT NULL
);
INSERT INTO reward_clock(next_period)
VALUES (date_trunc('month',now() AT TIME ZONE 'UTC')::date);

CREATE FUNCTION grant_achievements(target uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('achievement:' || target::text,0));
  INSERT INTO earned_achievements(user_id,code)
  SELECT target, thresholds.code
  FROM (VALUES
    ('initiative','created',1),('navigator','created',10),('architect','created',50),
    ('result','completed',1),('bridge','completed',10),('constellation','completed',25),
    ('summit','completed',50),('orbit','completed',100)
  ) AS thresholds(code,kind,goal)
  WHERE (SELECT count(*) FROM contribution_events e
    JOIN tasks t ON t.id=e.task_id JOIN boards b ON b.id=t.board_id
    WHERE e.user_id=target AND e.kind=thresholds.kind
      AND b.archived_at IS NULL AND (e.kind='created' OR t.completed_at IS NOT NULL)) >= thresholds.goal
  ON CONFLICT DO NOTHING;
END;
$$;
SELECT grant_achievements(id) FROM users;
CREATE FUNCTION grant_contribution_achievements() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM grant_achievements(NEW.user_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER contribution_achievements AFTER INSERT ON contribution_events
FOR EACH ROW EXECUTE FUNCTION grant_contribution_achievements();

-- Close a season before the first subsequent mutation, not after a task was
-- reopened/deleted. Also callable on read for a quiet workspace. Ties share place.
CREATE FUNCTION finalize_reward_seasons(as_of timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql AS $$
DECLARE next_month date; current_month date;
BEGIN
  current_month := date_trunc('month',as_of AT TIME ZONE 'UTC')::date;
  SELECT next_period INTO next_month FROM reward_clock WHERE singleton;
  IF next_month >= current_month THEN RETURN; END IF;
  SELECT next_period INTO next_month FROM reward_clock WHERE singleton FOR UPDATE;
  WHILE next_month < current_month LOOP
    INSERT INTO reward_seasons(period) VALUES(next_month) ON CONFLICT DO NOTHING;
    INSERT INTO monthly_rewards(period,user_id,place,points,completed)
    SELECT next_month,user_id,place,points,completed FROM (
      SELECT user_id,points,completed,rank() OVER (ORDER BY points DESC)::int AS place
      FROM (
        SELECT e.user_id,sum(e.points)::int AS points,
          count(*) FILTER (WHERE e.kind='completed')::int AS completed
        FROM contribution_events e
        JOIN tasks t ON t.id=e.task_id JOIN boards b ON b.id=t.board_id
        JOIN users u ON u.id=e.user_id
        WHERE e.created_at >= next_month::timestamp AT TIME ZONE 'UTC'
          AND e.created_at < (next_month + interval '1 month')::timestamp AT TIME ZONE 'UTC'
          AND b.archived_at IS NULL AND u.archived_at IS NULL
          AND (e.kind='created' OR t.completed_at IS NOT NULL)
        GROUP BY e.user_id
        HAVING count(*) FILTER (WHERE e.kind='completed') > 0
      ) eligible
    ) ranked WHERE place <= 3
    ON CONFLICT DO NOTHING;
    next_month := (next_month + interval '1 month')::date;
    UPDATE reward_clock SET next_period=next_month WHERE singleton;
  END LOOP;
END;
$$;
CREATE FUNCTION finalize_rewards_before_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM finalize_reward_seasons();
  RETURN NULL;
END;
$$;
CREATE TRIGGER rewards_before_tasks BEFORE INSERT OR UPDATE OR DELETE ON tasks
FOR EACH STATEMENT EXECUTE FUNCTION finalize_rewards_before_change();
CREATE TRIGGER rewards_before_boards BEFORE UPDATE OR DELETE ON boards
FOR EACH STATEMENT EXECUTE FUNCTION finalize_rewards_before_change();
CREATE TRIGGER rewards_before_users BEFORE UPDATE OR DELETE ON users
FOR EACH STATEMENT EXECUTE FUNCTION finalize_rewards_before_change();
CREATE TRIGGER rewards_before_events BEFORE INSERT OR UPDATE OR DELETE ON contribution_events
FOR EACH STATEMENT EXECUTE FUNCTION finalize_rewards_before_change();

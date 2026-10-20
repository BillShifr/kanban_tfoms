-- A single task transaction can credit both an author and an assignee.
-- Do not wait on inverted per-user locks in concurrent cross-assigned tasks.
-- A subsequent authenticated collection read reconciles a contended grant.
CREATE OR REPLACE FUNCTION grant_achievements(target uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('achievement:' || target::text,0)) THEN
    RETURN;
  END IF;
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

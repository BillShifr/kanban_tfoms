-- Preserve the real task timestamps so lifetime achievements and monthly scores
-- reflect when the work happened. The primary key makes this safe for databases
-- where some events were already recorded after the rewards feature was enabled.
INSERT INTO contribution_events(task_id, user_id, kind, points, created_at)
SELECT id, author_id, 'created', 2, created_at
FROM tasks
ON CONFLICT (task_id, kind) DO NOTHING;

INSERT INTO contribution_events(task_id, user_id, kind, points, created_at)
SELECT id, assignee_id, 'completed', 10, completed_at
FROM tasks
WHERE completed_at IS NOT NULL AND assignee_id IS NOT NULL
ON CONFLICT (task_id, kind) DO NOTHING;

-- Reconcile achievements even if an insert-time grant skipped a contended user.
SELECT grant_achievements(id) FROM users;

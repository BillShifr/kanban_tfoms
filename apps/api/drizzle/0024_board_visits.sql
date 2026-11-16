CREATE TABLE board_visits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id)
);

CREATE INDEX board_visits_board_user_idx ON board_visits (board_id, user_id);

INSERT INTO board_visits (user_id, board_id, last_seen_at)
SELECT DISTINCT access.user_id, access.board_id, now()
FROM (
  SELECT bm.user_id, bm.board_id
  FROM board_members bm
  UNION
  SELECT dm.user_id, b.id
  FROM department_members dm
  INNER JOIN boards b ON b.department_id = dm.department_id
  UNION
  SELECT u.id, b.id
  FROM users u
  CROSS JOIN boards b
  WHERE u.role IN ('superadmin', 'admin')
) access
ON CONFLICT DO NOTHING;
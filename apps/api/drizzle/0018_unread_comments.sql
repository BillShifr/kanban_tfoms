CREATE TABLE task_comment_unread (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, comment_id)
);

CREATE FUNCTION notify_task_comment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO task_comment_unread(user_id, comment_id)
  SELECT DISTINCT recipient, NEW.id
  FROM tasks t CROSS JOIN LATERAL
    unnest(ARRAY[t.author_id, t.assignee_id]) AS recipient
  WHERE t.id = NEW.task_id AND recipient IS NOT NULL
    AND recipient <> NEW.author_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_comment_notification AFTER INSERT ON task_comments
FOR EACH ROW EXECUTE FUNCTION notify_task_comment();

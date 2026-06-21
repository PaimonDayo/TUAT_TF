-- お知らせ投稿時に「メンバーに通知するか」を選べるようにする。
-- notices.notify_members（既定 true）を追加し、通知トリガーがこれを見るようにする。

ALTER TABLE notices ADD COLUMN IF NOT EXISTS notify_members BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION handle_notice_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 投稿者が「メンバーに通知」をオフにした場合は通知を作らない
  IF NEW.notify_members THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT id, NEW.author_id, 'notice', 'notice', NEW.id
    FROM profiles
    WHERE status = 'active' AND notify_notice = TRUE AND id != NEW.author_id;
  END IF;

  RETURN NEW;
END;
$$;

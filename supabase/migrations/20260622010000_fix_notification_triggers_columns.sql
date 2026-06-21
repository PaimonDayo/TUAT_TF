-- 通知トリガーの列名修正（Antigravity実装のバグ修正 / Claude）
-- バグ1: profiles に boolean `active` は無い。正しくは status = 'active'。
-- バグ2: practice_schedules の列名は schedule_date / meeting_time / end_date /
--        venue_name / location / title / note。date/start_time/end_time/venue_id は存在しない。
-- バグ3: notices の作成者列は author_id（created_by は存在しない）。
-- 3関数を正しい列名で CREATE OR REPLACE で上書きする（冪等）。

-- コメント通知
CREATE OR REPLACE FUNCTION handle_new_comment_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  target_owner_id UUID;
  target_owner_notify_comment BOOLEAN := TRUE;
  is_active BOOLEAN := TRUE;
BEGIN
  IF NEW.target_type = 'record' THEN
    SELECT user_id INTO target_owner_id FROM practice_records WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'tweet' THEN
    SELECT user_id INTO target_owner_id FROM tweets WHERE id = NEW.target_id;
  END IF;

  IF target_owner_id IS NOT NULL AND target_owner_id != NEW.user_id THEN
    SELECT (status = 'active'), notify_comment
      INTO is_active, target_owner_notify_comment
      FROM profiles WHERE id = target_owner_id;
    IF is_active AND target_owner_notify_comment THEN
      INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
      VALUES (target_owner_id, NEW.user_id, 'comment', NEW.target_type, NEW.target_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 予定通知（追加・主要項目の変更時に全アクティブ部員へ。作成者は除外）
CREATE OR REPLACE FUNCTION handle_schedule_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (
        NEW.schedule_date IS DISTINCT FROM OLD.schedule_date
     OR NEW.meeting_time  IS DISTINCT FROM OLD.meeting_time
     OR NEW.end_date      IS DISTINCT FROM OLD.end_date
     OR NEW.location      IS DISTINCT FROM OLD.location
     OR NEW.venue_name    IS DISTINCT FROM OLD.venue_name
     OR NEW.title         IS DISTINCT FROM OLD.title
     OR NEW.note          IS DISTINCT FROM OLD.note
  )) THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT id, NEW.created_by, 'schedule_update', 'schedule', NEW.id
    FROM profiles
    WHERE status = 'active' AND notify_schedule = TRUE AND id != NEW.created_by;
  END IF;

  RETURN NEW;
END;
$$;

-- お知らせ通知（投稿時に全アクティブ部員へ。作成者は除外）
CREATE OR REPLACE FUNCTION handle_notice_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
  SELECT id, NEW.author_id, 'notice', 'notice', NEW.id
  FROM profiles
  WHERE status = 'active' AND notify_notice = TRUE AND id != NEW.author_id;

  RETURN NEW;
END;
$$;

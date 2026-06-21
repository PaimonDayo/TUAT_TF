-- Phase 2: Add notification settings to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_comment  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_schedule BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_notice   BOOLEAN NOT NULL DEFAULT TRUE;

-- Update Triggers for comment to check notify_comment
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
    SELECT active, notify_comment INTO is_active, target_owner_notify_comment FROM profiles WHERE id = target_owner_id;
    IF is_active AND target_owner_notify_comment THEN
      INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
      VALUES (target_owner_id, NEW.user_id, 'comment', NEW.target_type, NEW.target_id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update Triggers for schedule to check notify_schedule
CREATE OR REPLACE FUNCTION handle_schedule_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.date != OLD.date OR NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time OR NEW.venue_id IS DISTINCT FROM OLD.venue_id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.note IS DISTINCT FROM OLD.note)) THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT id, NEW.created_by, 'schedule_update', 'schedule', NEW.id
    FROM profiles
    WHERE active = true AND notify_schedule = true AND id != NEW.created_by;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update Triggers for notices to check notify_notice
CREATE OR REPLACE FUNCTION handle_notice_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
  SELECT id, NEW.created_by, 'notice', 'notice', NEW.id
  FROM profiles
  WHERE active = true AND notify_notice = true AND id != NEW.created_by;
  
  RETURN NEW;
END;
$$;

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  type           TEXT NOT NULL CHECK (type IN ('comment','schedule_update','notice')),
  reference_type TEXT CHECK (reference_type IN ('record','tweet','schedule','notice')),
  reference_id   UUID,
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
CREATE POLICY "Users can view own notifications" 
  ON notifications FOR SELECT 
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" 
  ON notifications FOR UPDATE 
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications" 
  ON notifications FOR DELETE 
  USING (user_id = auth.uid());

-- Triggers for comment
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
  -- We assume profiles will have notify_comment, default true
  -- But we only check if the profile is active for now
  IF NEW.target_type = 'record' THEN
    SELECT user_id INTO target_owner_id FROM practice_records WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'tweet' THEN
    SELECT user_id INTO target_owner_id FROM tweets WHERE id = NEW.target_id;
  END IF;

  -- Only notify if the commenter is not the owner
  IF target_owner_id IS NOT NULL AND target_owner_id != NEW.user_id THEN
    -- Check if active (we will add notify_comment in phase 2, so here we just assume TRUE)
    SELECT active INTO is_active FROM profiles WHERE id = target_owner_id;
    IF is_active THEN
      INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
      VALUES (target_owner_id, NEW.user_id, 'comment', NEW.target_type, NEW.target_id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_comment_created ON comments;
CREATE TRIGGER on_comment_created
  AFTER INSERT ON comments
  FOR EACH ROW EXECUTE FUNCTION handle_new_comment_notification();

-- Triggers for schedule
CREATE OR REPLACE FUNCTION handle_schedule_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert for all active users except the creator
  -- We will check notify_schedule in phase 2, assuming TRUE for now
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW.date != OLD.date OR NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time OR NEW.venue_id IS DISTINCT FROM OLD.venue_id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.note IS DISTINCT FROM OLD.note)) THEN
    INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT id, NEW.created_by, 'schedule_update', 'schedule', NEW.id
    FROM profiles
    WHERE active = true AND id != NEW.created_by;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_schedule_changed ON practice_schedules;
CREATE TRIGGER on_schedule_changed
  AFTER INSERT OR UPDATE ON practice_schedules
  FOR EACH ROW EXECUTE FUNCTION handle_schedule_notification();

-- Triggers for notices
CREATE OR REPLACE FUNCTION handle_notice_notification()
RETURNS trigger
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert for all active users except the creator
  INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
  SELECT id, NEW.created_by, 'notice', 'notice', NEW.id
  FROM profiles
  WHERE active = true AND id != NEW.created_by;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notice_created ON notices;
CREATE TRIGGER on_notice_created
  AFTER INSERT ON notices
  FOR EACH ROW EXECUTE FUNCTION handle_notice_notification();

ALTER TABLE public.attendances ADD COLUMN IF NOT EXISTS absence_note TEXT;
ALTER TABLE public.attendances DROP CONSTRAINT IF EXISTS attendances_absence_note_length;
ALTER TABLE public.attendances ADD CONSTRAINT attendances_absence_note_length CHECK (absence_note IS NULL OR char_length(absence_note) <= 60);
UPDATE public.attendances SET absence_note = NULL WHERE status <> 'absent';
ALTER TABLE public.attendances DROP CONSTRAINT IF EXISTS attendances_absence_note_requires_absent;
ALTER TABLE public.attendances ADD CONSTRAINT attendances_absence_note_requires_absent CHECK (status = 'absent' OR absence_note IS NULL);

UPDATE public.practice_records AS record SET likes_count = (SELECT count(*)::integer FROM public.likes WHERE target_type = 'record' AND target_id = record.id);
UPDATE public.tweets AS tweet SET likes_count = (SELECT count(*)::integer FROM public.likes WHERE target_type = 'tweet' AND target_id = tweet.id);

CREATE OR REPLACE FUNCTION public.sync_likes_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  affected_type TEXT := COALESCE(NEW.target_type, OLD.target_type);
  affected_id UUID := COALESCE(NEW.target_id, OLD.target_id);
  actual_count INTEGER;
BEGIN
  SELECT count(*)::integer INTO actual_count FROM public.likes WHERE target_type = affected_type AND target_id = affected_id;
  IF affected_type = 'record' THEN
    UPDATE public.practice_records SET likes_count = actual_count WHERE id = affected_id;
  ELSIF affected_type = 'tweet' THEN
    UPDATE public.tweets SET likes_count = actual_count WHERE id = affected_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

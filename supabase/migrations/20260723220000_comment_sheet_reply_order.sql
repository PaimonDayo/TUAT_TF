ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS sheet_reply_index INTEGER;

ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_sheet_reply_index_nonnegative;
ALTER TABLE public.comments
  ADD CONSTRAINT comments_sheet_reply_index_nonnegative
  CHECK (sheet_reply_index IS NULL OR sheet_reply_index >= 0);

CREATE INDEX IF NOT EXISTS idx_comments_sheet_reply_order
  ON public.comments(target_type, target_id, sheet_reply_index);

CREATE OR REPLACE FUNCTION public.set_comments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.updated_at = NOW();
  ELSE
    NEW.updated_at = OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

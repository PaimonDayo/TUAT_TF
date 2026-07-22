-- Mirror anonymous replies entered directly in member spreadsheets.
-- This changes only Supabase data structures; it does not alter spreadsheet sharing or GAS settings.
CREATE TABLE IF NOT EXISTS public.sheet_record_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.practice_records(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recorded_date DATE NOT NULL,
  reply_index INTEGER NOT NULL CHECK (reply_index >= 0),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (record_id, reply_index)
);

CREATE INDEX IF NOT EXISTS idx_sheet_record_replies_record
  ON public.sheet_record_replies(record_id, reply_index);
CREATE INDEX IF NOT EXISTS idx_sheet_record_replies_owner_date
  ON public.sheet_record_replies(owner_id, recorded_date);

ALTER TABLE public.sheet_record_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sheet_record_replies_select" ON public.sheet_record_replies;
CREATE POLICY "sheet_record_replies_select"
  ON public.sheet_record_replies
  FOR SELECT
  TO authenticated
  USING (TRUE);

REVOKE ALL ON TABLE public.sheet_record_replies FROM anon;
GRANT SELECT ON TABLE public.sheet_record_replies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sheet_record_replies TO service_role;

CREATE OR REPLACE FUNCTION public.replace_sheet_record_replies(
  target_record_id UUID,
  reply_rows JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  record_owner UUID;
  record_date DATE;
BEGIN
  SELECT pr.user_id, pr.recorded_date
  INTO record_owner, record_date
  FROM public.practice_records pr
  WHERE pr.id = target_record_id;

  IF record_owner IS NULL THEN
    RAISE EXCEPTION 'Record not found';
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR record_owner <> auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to update sheet replies';
  END IF;

  IF jsonb_typeof(COALESCE(reply_rows, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'reply_rows must be an array';
  END IF;

  DELETE FROM public.sheet_record_replies
  WHERE record_id = target_record_id;

  INSERT INTO public.sheet_record_replies (
    record_id, owner_id, recorded_date, reply_index, content, synced_at
  )
  SELECT
    target_record_id,
    record_owner,
    record_date,
    (reply ->> 'replyIndex')::INTEGER,
    btrim(reply ->> 'content'),
    NOW()
  FROM jsonb_array_elements(COALESCE(reply_rows, '[]'::JSONB)) AS reply
  WHERE (reply ->> 'replyIndex') ~ '^[0-9]+$'
    AND char_length(btrim(reply ->> 'content')) BETWEEN 1 AND 2000
  ON CONFLICT (record_id, reply_index) DO UPDATE
  SET content = EXCLUDED.content, synced_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.replace_sheet_record_replies(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_sheet_record_replies(UUID, JSONB)
  TO authenticated, service_role;

-- Include spreadsheet replies in the count shown on record cards.
CREATE OR REPLACE FUNCTION public.count_comments_by_target(
  target_type_in TEXT,
  target_ids UUID[]
)
RETURNS TABLE(target_id UUID, count BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH all_replies AS (
    SELECT c.target_id
    FROM public.comments c
    WHERE c.target_type = target_type_in
      AND c.target_id = ANY(target_ids)

    UNION ALL

    SELECT sr.record_id
    FROM public.sheet_record_replies sr
    WHERE target_type_in = 'record'
      AND sr.record_id = ANY(target_ids)
  )
  SELECT reply.target_id, COUNT(*)
  FROM all_replies reply
  GROUP BY reply.target_id;
$$;

REVOKE ALL ON FUNCTION public.count_comments_by_target(TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_comments_by_target(TEXT, UUID[]) TO authenticated;

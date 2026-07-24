-- Count an app comment and its spreadsheet mirror as one reply.
-- sheet_reply_index is stable even when the comment author's display name changes.
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.comments c
        WHERE c.target_type = 'record'
          AND c.target_id = sr.record_id
          AND c.sheet_reply_index = sr.reply_index
      )
  )
  SELECT reply.target_id, COUNT(*)
  FROM all_replies reply
  GROUP BY reply.target_id;
$$;

REVOKE ALL ON FUNCTION public.count_comments_by_target(TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_comments_by_target(TEXT, UUID[]) TO authenticated;

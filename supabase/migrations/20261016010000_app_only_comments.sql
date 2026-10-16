-- Replies now belong only to the app. Keep imported rows, export indexes and
-- deletion receipts as history; never drain or replay the old outbound queue.
DROP TRIGGER IF EXISTS queue_comment_sheet_deletion ON public.comments;
DROP POLICY IF EXISTS sheet_record_replies_select ON public.sheet_record_replies;
REVOKE SELECT ON public.sheet_record_replies FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.replace_sheet_record_replies(
  target_record_id uuid, reply_rows jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'sheet_reply_sync_retired' USING ERRCODE='0A000';
END;
$$;
REVOKE ALL ON FUNCTION public.replace_sheet_record_replies(uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Keep the old signature safe for cached app clients. Sheet reply deletion is
-- retired; app deletion retains exactly the existing owner/moderator boundary.
CREATE OR REPLACE FUNCTION public.delete_comment_with_sheet(p_id uuid,p_kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.comments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'comment_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_kind IS DISTINCT FROM 'app' THEN
    RAISE EXCEPTION 'sheet_reply_sync_retired' USING ERRCODE='0A000';
  END IF;
  SELECT * INTO c FROM public.comments WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.user_id IS DISTINCT FROM auth.uid() AND NOT public.can_moderate_comments() THEN
    RAISE EXCEPTION 'comment_forbidden' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.comments WHERE id=p_id;
  RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_comment_with_sheet(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_comment_with_sheet(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.count_comments_by_target(target_type_in text,target_ids uuid[])
RETURNS TABLE(target_id uuid,count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT c.target_id, count(*)
  FROM public.comments c
  WHERE c.target_type=target_type_in AND c.target_id=ANY(target_ids)
  GROUP BY c.target_id;
$$;
REVOKE ALL ON FUNCTION public.count_comments_by_target(text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.count_comments_by_target(text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_feed_social_state(record_ids uuid[],tweet_ids uuid[])
RETURNS TABLE(target_type text,target_id uuid,liked_by_me boolean,comments_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH requested AS (
    SELECT 'record'::text AS target_type,id AS target_id
    FROM unnest(coalesce(record_ids,ARRAY[]::uuid[])) AS id
    UNION ALL
    SELECT 'tweet'::text AS target_type,id AS target_id
    FROM unnest(coalesce(tweet_ids,ARRAY[]::uuid[])) AS id
  ), reply_counts AS (
    SELECT c.target_type,c.target_id,count(*)::bigint AS count
    FROM public.comments c
    JOIN requested r ON r.target_type=c.target_type AND r.target_id=c.target_id
    GROUP BY c.target_type,c.target_id
  )
  SELECT r.target_type,r.target_id,
    EXISTS(SELECT 1 FROM public.likes l WHERE l.user_id=auth.uid()
      AND l.target_type=r.target_type AND l.target_id=r.target_id),
    coalesce(c.count,0)::bigint
  FROM requested r
  LEFT JOIN reply_counts c ON c.target_type=r.target_type AND c.target_id=r.target_id;
$$;
REVOKE ALL ON FUNCTION public.get_feed_social_state(uuid[],uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_feed_social_state(uuid[],uuid[]) TO authenticated;

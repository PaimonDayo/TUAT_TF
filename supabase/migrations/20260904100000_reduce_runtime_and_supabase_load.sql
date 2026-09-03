-- Reduce timeline round-trips, make like mutations atomic, and remember
-- spreadsheet content hashes so unchanged tabs do not need to be parsed or diffed.

CREATE OR REPLACE FUNCTION public.get_feed_social_state(
  record_ids UUID[],
  tweet_ids UUID[]
)
RETURNS TABLE(
  target_type TEXT,
  target_id UUID,
  liked_by_me BOOLEAN,
  comments_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT 'record'::TEXT AS target_type, id AS target_id
    FROM unnest(COALESCE(record_ids, ARRAY[]::UUID[])) AS id
    UNION ALL
    SELECT 'tweet'::TEXT AS target_type, id AS target_id
    FROM unnest(COALESCE(tweet_ids, ARRAY[]::UUID[])) AS id
  ), all_replies AS (
    SELECT c.target_type, c.target_id
    FROM public.comments c
    JOIN requested r
      ON r.target_type = c.target_type AND r.target_id = c.target_id

    UNION ALL

    SELECT 'record'::TEXT, sr.record_id
    FROM public.sheet_record_replies sr
    WHERE sr.record_id = ANY(COALESCE(record_ids, ARRAY[]::UUID[]))
      AND NOT EXISTS (
        SELECT 1
        FROM public.comments c
        WHERE c.target_type = 'record'
          AND c.target_id = sr.record_id
          AND c.sheet_reply_index = sr.reply_index
      )
  ), reply_counts AS (
    SELECT reply.target_type, reply.target_id, COUNT(*)::BIGINT AS count
    FROM all_replies reply
    GROUP BY reply.target_type, reply.target_id
  )
  SELECT
    r.target_type,
    r.target_id,
    EXISTS (
      SELECT 1
      FROM public.likes l
      WHERE l.user_id = auth.uid()
        AND l.target_type = r.target_type
        AND l.target_id = r.target_id
    ) AS liked_by_me,
    COALESCE(c.count, 0)::BIGINT AS comments_count
  FROM requested r
  LEFT JOIN reply_counts c
    ON c.target_type = r.target_type AND c.target_id = r.target_id;
$$;

REVOKE ALL ON FUNCTION public.get_feed_social_state(UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_feed_social_state(UUID[], UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tweet_feed_extras(tweet_ids UUID[])
RETURNS TABLE(tweet_id UUID, options JSONB, mentions JSONB)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS tweet_id,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'tweet_id', o.tweet_id,
          'text', o.text,
          'created_by', o.created_by,
          'sort_order', o.sort_order,
          'vote_count', (SELECT COUNT(*) FROM public.tweet_poll_votes v WHERE v.option_id = o.id),
          'voted_by_me', EXISTS (
            SELECT 1 FROM public.tweet_poll_votes v
            WHERE v.option_id = o.id AND v.user_id = auth.uid()
          ),
          'voters', CASE WHEN t.poll_anonymous THEN '[]'::JSONB ELSE COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'profile_id', p.id,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'blocks', COALESCE(p.blocks, ARRAY[]::TEXT[]),
                'grade', p.grade
              )
              ORDER BY p.display_name, p.id
            )
            FROM public.tweet_poll_votes v
            JOIN public.profiles p ON p.id = v.user_id
            WHERE v.option_id = o.id
          ), '[]'::JSONB) END
        )
        ORDER BY o.sort_order, o.id
      )
      FROM public.tweet_poll_options o
      WHERE o.tweet_id = t.id
    ), '[]'::JSONB) AS options,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('profile_id', p.id, 'display_name', p.display_name)
        ORDER BY p.display_name, p.id
      )
      FROM public.tweet_mentions m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.tweet_id = t.id
    ), '[]'::JSONB) AS mentions
  FROM public.tweets t
  WHERE t.id = ANY(COALESCE(tweet_ids, ARRAY[]::UUID[]));
$$;

REVOKE ALL ON FUNCTION public.get_tweet_feed_extras(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tweet_feed_extras(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_like_state(
  target_type_in TEXT,
  target_id_in UUID,
  desired_liked BOOLEAN
)
RETURNS TABLE(liked BOOLEAN, likes_count BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  viewer_id UUID := auth.uid();
BEGIN
  IF viewer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF target_type_in NOT IN ('record', 'tweet') THEN
    RAISE EXCEPTION 'Invalid target type' USING ERRCODE = '22023';
  END IF;

  IF desired_liked THEN
    INSERT INTO public.likes (user_id, target_type, target_id)
    VALUES (viewer_id, target_type_in, target_id_in)
    ON CONFLICT (user_id, target_type, target_id) DO NOTHING;
  ELSE
    DELETE FROM public.likes l
    WHERE l.user_id = viewer_id
      AND l.target_type = target_type_in
      AND l.target_id = target_id_in;
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1 FROM public.likes l
      WHERE l.user_id = viewer_id
        AND l.target_type = target_type_in
        AND l.target_id = target_id_in
    ),
    COUNT(*)::BIGINT
  FROM public.likes l
  WHERE l.target_type = target_type_in AND l.target_id = target_id_in;
END;
$$;

REVOKE ALL ON FUNCTION public.set_like_state(TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_like_state(TEXT, UUID, BOOLEAN) TO authenticated;

CREATE TABLE IF NOT EXISTS public.sheet_member_sync_state (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_signature TEXT NOT NULL,
  config_signature TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sheet_member_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sheet_member_sync_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sheet_member_sync_state TO service_role;

-- There are no longer any clients listening to the whole likes table. Keeping it
-- out of Realtime avoids broadcasting every club member's likes to every timeline.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.likes;
  END IF;
END;
$$;

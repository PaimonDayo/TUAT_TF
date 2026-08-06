DROP FUNCTION IF EXISTS public.get_poll_voters(UUID[]);

CREATE FUNCTION public.get_poll_voters(tweet_ids UUID[])
RETURNS TABLE(
  option_id UUID,
  profile_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  blocks TEXT[],
  grade TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    v.option_id,
    p.id,
    p.display_name,
    p.avatar_url,
    COALESCE(p.blocks, ARRAY[]::TEXT[]),
    p.grade
  FROM public.tweet_poll_votes v
  JOIN public.tweet_poll_options o ON o.id = v.option_id
  JOIN public.tweets t ON t.id = o.tweet_id
  JOIN public.profiles p ON p.id = v.user_id
  WHERE o.tweet_id = ANY(tweet_ids)
    AND NOT t.poll_anonymous;
$$;

REVOKE ALL ON FUNCTION public.get_poll_voters(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_voters(UUID[]) TO authenticated;

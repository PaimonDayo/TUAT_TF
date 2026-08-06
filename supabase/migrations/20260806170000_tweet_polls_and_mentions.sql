-- Polls and mentions for tweets and stories.
ALTER TABLE public.tweets
  ADD COLUMN poll_multiple BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN poll_anonymous BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN poll_allow_options BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public.tweet_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tweet_id UUID NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 80),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tweet_poll_votes (
  option_id UUID NOT NULL REFERENCES public.tweet_poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);

CREATE TABLE public.tweet_mentions (
  tweet_id UUID NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tweet_id, profile_id)
);

ALTER TABLE public.profiles
  ADD COLUMN notify_mention BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX tweet_poll_options_tweet_idx ON public.tweet_poll_options(tweet_id, sort_order);
CREATE INDEX tweet_poll_votes_option_idx ON public.tweet_poll_votes(option_id);
CREATE INDEX tweet_mentions_profile_idx ON public.tweet_mentions(profile_id, created_at DESC);

ALTER TABLE public.tweet_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tweet_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tweet_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poll_options_select" ON public.tweet_poll_options
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "poll_options_insert" ON public.tweet_poll_options
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid() AND (
      EXISTS (SELECT 1 FROM public.tweets t WHERE t.id = tweet_id AND t.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.tweets t WHERE t.id = tweet_id AND t.poll_allow_options)
    )
  );
CREATE POLICY "poll_options_delete" ON public.tweet_poll_options
  FOR DELETE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.tweets t WHERE t.id = tweet_id AND t.user_id = auth.uid())
  );

CREATE POLICY "poll_votes_select_own" ON public.tweet_poll_votes
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "poll_votes_insert_own" ON public.tweet_poll_votes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "poll_votes_delete_own" ON public.tweet_poll_votes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "tweet_mentions_select" ON public.tweet_mentions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "tweet_mentions_insert_own_tweet" ON public.tweet_mentions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.tweets t WHERE t.id = tweet_id AND t.user_id = auth.uid())
  );
CREATE POLICY "tweet_mentions_delete_own_tweet" ON public.tweet_mentions
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tweets t WHERE t.id = tweet_id AND t.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.enforce_poll_vote_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_tweet UUID;
  allows_multiple BOOLEAN;
BEGIN
  SELECT o.tweet_id, t.poll_multiple
    INTO target_tweet, allows_multiple
  FROM public.tweet_poll_options o
  JOIN public.tweets t ON t.id = o.tweet_id
  WHERE o.id = NEW.option_id;

  IF target_tweet IS NULL THEN
    RAISE EXCEPTION 'Poll option not found';
  END IF;

  IF NOT allows_multiple AND EXISTS (
    SELECT 1
    FROM public.tweet_poll_votes v
    JOIN public.tweet_poll_options o ON o.id = v.option_id
    WHERE o.tweet_id = target_tweet AND v.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Only one option may be selected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_poll_vote_rules
  BEFORE INSERT ON public.tweet_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poll_vote_rules();

CREATE OR REPLACE FUNCTION public.get_poll_results(tweet_ids UUID[])
RETURNS TABLE(option_id UUID, vote_count BIGINT, voted_by_me BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT o.id,
         count(v.user_id)::BIGINT,
         bool_or(v.user_id = auth.uid())
  FROM public.tweet_poll_options o
  LEFT JOIN public.tweet_poll_votes v ON v.option_id = o.id
  WHERE o.tweet_id = ANY(tweet_ids)
  GROUP BY o.id;
$$;
REVOKE ALL ON FUNCTION public.get_poll_results(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_results(UUID[]) TO authenticated;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('comment','notice','sync_failure','thread_reply','mention'));

CREATE OR REPLACE FUNCTION public.handle_tweet_mention_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  author_id UUID;
BEGIN
  SELECT user_id INTO author_id FROM public.tweets WHERE id = NEW.tweet_id;
  IF NEW.profile_id <> author_id
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.profile_id AND notify_mention) THEN
    INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
    VALUES (NEW.profile_id, author_id, 'mention', 'tweet', NEW.tweet_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tweet_mention_notification
  AFTER INSERT ON public.tweet_mentions
  FOR EACH ROW EXECUTE FUNCTION public.handle_tweet_mention_notification();

CREATE OR REPLACE FUNCTION public.get_poll_voters(tweet_ids UUID[])
RETURNS TABLE(option_id UUID, profile_id UUID, display_name TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT v.option_id, p.id, p.display_name
  FROM public.tweet_poll_votes v
  JOIN public.tweet_poll_options o ON o.id = v.option_id
  JOIN public.tweets t ON t.id = o.tweet_id
  JOIN public.profiles p ON p.id = v.user_id
  WHERE o.tweet_id = ANY(tweet_ids) AND NOT t.poll_anonymous;
$$;
REVOKE ALL ON FUNCTION public.get_poll_voters(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_poll_voters(UUID[]) TO authenticated;

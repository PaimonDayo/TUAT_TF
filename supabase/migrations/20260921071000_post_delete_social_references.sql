-- Keep polymorphic social references consistent with their parent post.
CREATE OR REPLACE FUNCTION public.posts_delete_social_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE post_type text;
BEGIN
  IF TG_TABLE_NAME = 'tweets' THEN post_type := 'tweet';
  ELSIF TG_TABLE_NAME = 'practice_records' THEN post_type := 'record';
  ELSE RAISE EXCEPTION 'Unsupported post table';
  END IF;
  DELETE FROM public.comments WHERE target_type = post_type AND target_id = OLD.id;
  DELETE FROM public.likes WHERE target_type = post_type AND target_id = OLD.id;
  DELETE FROM public.notifications WHERE reference_type = post_type AND reference_id = OLD.id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.posts_delete_social_references() FROM PUBLIC;
DROP TRIGGER IF EXISTS tweets_delete_social_references ON public.tweets;
CREATE TRIGGER tweets_delete_social_references AFTER DELETE ON public.tweets
FOR EACH ROW EXECUTE FUNCTION public.posts_delete_social_references();
DROP TRIGGER IF EXISTS records_delete_social_references ON public.practice_records;
CREATE TRIGGER records_delete_social_references AFTER DELETE ON public.practice_records
FOR EACH ROW EXECUTE FUNCTION public.posts_delete_social_references();

-- Existing orphans only; take a private snapshot before applying this migration.
DELETE FROM public.comments c WHERE ((c.target_type='tweet' AND NOT EXISTS (SELECT 1 FROM public.tweets p WHERE p.id=c.target_id)) OR (c.target_type='record' AND NOT EXISTS (SELECT 1 FROM public.practice_records p WHERE p.id=c.target_id)));
DELETE FROM public.likes l WHERE ((l.target_type='tweet' AND NOT EXISTS (SELECT 1 FROM public.tweets p WHERE p.id=l.target_id)) OR (l.target_type='record' AND NOT EXISTS (SELECT 1 FROM public.practice_records p WHERE p.id=l.target_id)));
DELETE FROM public.notifications n WHERE ((n.reference_type='tweet' AND NOT EXISTS (SELECT 1 FROM public.tweets p WHERE p.id=n.reference_id)) OR (n.reference_type='record' AND NOT EXISTS (SELECT 1 FROM public.practice_records p WHERE p.id=n.reference_id)));

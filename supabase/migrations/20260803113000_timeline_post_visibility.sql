-- Members can opt their records and short posts out of timeline lists.
-- Existing accounts remain visible unless they explicitly turn this off.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timeline_posts_visible BOOLEAN;

UPDATE public.profiles SET timeline_posts_visible = TRUE WHERE timeline_posts_visible IS NULL;

ALTER TABLE public.profiles ALTER COLUMN timeline_posts_visible SET DEFAULT TRUE, ALTER COLUMN timeline_posts_visible SET NOT NULL;

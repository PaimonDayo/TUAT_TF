-- Remove the unused per-member timeline visibility preference.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS timeline_posts_visible;

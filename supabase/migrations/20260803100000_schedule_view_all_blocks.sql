ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS schedule_view_all_blocks BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.profiles
SET schedule_view_all_blocks = TRUE
WHERE blocks = ARRAY['manager']::TEXT[];

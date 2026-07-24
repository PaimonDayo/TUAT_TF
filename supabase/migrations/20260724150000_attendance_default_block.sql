ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attendance_default_block TEXT;

UPDATE public.profiles
SET attendance_default_block = CASE
  WHEN attendance_view_all_blocks THEN 'all'
  WHEN blocks[1] = 'middle_long' THEN 'middle_long'
  WHEN blocks[1] IN ('short', 'jump', 'throw') THEN 'short'
  ELSE 'all'
END
WHERE attendance_default_block IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN attendance_default_block SET DEFAULT 'all',
  ALTER COLUMN attendance_default_block SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_attendance_default_block_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_attendance_default_block_check
  CHECK (attendance_default_block IN ('all', 'middle_long', 'short'));

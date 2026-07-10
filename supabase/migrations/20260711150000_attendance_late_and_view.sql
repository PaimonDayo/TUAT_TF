ALTER TABLE public.attendances
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS late_note TEXT;

ALTER TABLE public.attendances
  DROP CONSTRAINT IF EXISTS attendances_late_note_length;
ALTER TABLE public.attendances
  ADD CONSTRAINT attendances_late_note_length
  CHECK (late_note IS NULL OR char_length(late_note) <= 60);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attendance_view_all_blocks BOOLEAN NOT NULL DEFAULT FALSE;

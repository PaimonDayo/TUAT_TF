-- 競合や旧クライアント経由でも「欠席＋遅刻」「遅刻OFF＋連絡事項」を保存させない。
UPDATE public.attendances
SET is_late = FALSE,
    late_note = NULL
WHERE status <> 'present' OR is_late = FALSE;

ALTER TABLE public.attendances
  DROP CONSTRAINT IF EXISTS attendances_late_requires_present;
ALTER TABLE public.attendances
  ADD CONSTRAINT attendances_late_requires_present
  CHECK (status = 'present' OR (is_late = FALSE AND late_note IS NULL));

ALTER TABLE public.attendances
  DROP CONSTRAINT IF EXISTS attendances_note_requires_late;
ALTER TABLE public.attendances
  ADD CONSTRAINT attendances_note_requires_late
  CHECK (is_late = TRUE OR late_note IS NULL);

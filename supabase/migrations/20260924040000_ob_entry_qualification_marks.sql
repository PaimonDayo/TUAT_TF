-- 元フォームの自由記述を種目ごとに保持する。null=未回答、キーなし=フォームに欄なし。
ALTER TABLE public.ob_meet_entries
  ADD COLUMN IF NOT EXISTS qualification_marks jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(qualification_marks) = 'object');
-- 既存のシステム限定RLSとUPDATE列制限を維持する。
NOTIFY pgrst, 'reload schema';

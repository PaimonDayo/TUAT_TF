-- タイムラインの初期表示ブロック（出欠一覧の初期表示と同じ考え方）。
-- 既定は 'all'。新規列なので既存行はすべて 'all' から始まる。
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timeline_default_block TEXT;

UPDATE public.profiles
SET timeline_default_block = 'all'
WHERE timeline_default_block IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN timeline_default_block SET DEFAULT 'all',
  ALTER COLUMN timeline_default_block SET NOT NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_timeline_default_block_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_timeline_default_block_check
  CHECK (timeline_default_block IN ('all', 'middle_long', 'short'));

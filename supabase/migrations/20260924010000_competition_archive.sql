-- 将来時刻も指定できる非破壊アーカイブ。既存の管理者限定更新ポリシーを使用。
ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS archive_at timestamptz;
COMMENT ON COLUMN public.competitions.archive_at IS 'この時刻以降はホームと自動同期の対象外。目標・出場者・結果は保持する。';
UPDATE public.competitions SET archive_at = '2026-09-25 08:00:00+09'
WHERE starts_on BETWEEN '2026-09-01' AND '2026-09-24'
  AND (name LIKE '%27大%' OR name LIKE '%27対%') AND archive_at IS NULL;
NOTIFY pgrst, 'reload schema';

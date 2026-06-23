-- 記録の「出どころ」を区別する。
-- from_sheet=true … スプレッドシート同期で取り込んだ記録（ソーシャルなタイムラインには出さない）
-- from_sheet=false … アプリで入力した記録（タイムラインに出す）
-- 本人のマイページ集計（走行距離など）は両方を合算する。
ALTER TABLE practice_records
  ADD COLUMN IF NOT EXISTS from_sheet BOOLEAN NOT NULL DEFAULT false;

-- 既存のスプシ取り込み履歴（連携前=2026-06-22より前）はシート由来として扱う。
UPDATE practice_records
  SET from_sheet = true
  WHERE recorded_date < '2026-06-22' AND from_sheet = false;

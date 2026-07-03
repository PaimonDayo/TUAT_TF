-- スプシ同期を双方向(LWW)から部員ごとの方向固定へ。
-- sheet_name連携済みの部員は 'sheet'（同期はpullのみ）、未連携は 'app'（同期はpushのみ、実質no-op）。
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS record_source TEXT NOT NULL DEFAULT 'app';

ALTER TABLE profiles
DROP CONSTRAINT IF EXISTS profiles_record_source_check;

ALTER TABLE profiles
ADD CONSTRAINT profiles_record_source_check
CHECK (record_source IN ('app', 'sheet'));

-- 従来のスプシ取込を切らさないよう、連携済みの部員は初期値をsheetにする
UPDATE profiles SET record_source = 'sheet' WHERE sheet_name IS NOT NULL;

-- ロールのカテゴリ（フォルダ分け・表示用）。任意。
-- 冪等: 既に存在する場合は何もしない。

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS category TEXT;

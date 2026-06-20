-- プロフィールに「専門種目」を追加（情報表示用・複数可）。
-- 所属ブロック(blocks)はそのまま。events は任意で、記録フォームの分岐には使わない。
-- 冪等: 既に存在する場合は何もしない。

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS events TEXT[] NOT NULL DEFAULT '{}';

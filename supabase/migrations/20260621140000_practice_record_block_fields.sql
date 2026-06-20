-- 練習記録のブロック別フィールド追加
-- 短距離・跳躍・投擲ブロック向けの「メニュー」「目的・意識すること」を保存する。
-- 中長距離は従来どおり強度別距離などを使うため、両カラムとも NULL 許容。
-- 冪等: 既に存在する場合は何もしない。

ALTER TABLE practice_records
  ADD COLUMN IF NOT EXISTS menu_text  TEXT,
  ADD COLUMN IF NOT EXISTS focus_text TEXT;

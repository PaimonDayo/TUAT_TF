-- ═══════════════════════════════════════════════════════════════
-- 大会・記録会の結果に UB マーカーを追加 ＋ プロフィールに目標(自由入力)
--   - pb_records.is_ub : PB とは別に UB の印を付けられるようにする
--   - profiles.goal    : マイページから設定する目標（自由入力）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE pb_records
  ADD COLUMN IF NOT EXISTS is_ub BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS goal TEXT;

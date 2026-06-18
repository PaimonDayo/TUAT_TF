-- ═══════════════════════════════════════════════════════════════
-- 大会・記録会の結果に「公認」フラグを追加
--   pb_records.is_official : 公認記録かどうか
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE pb_records
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;

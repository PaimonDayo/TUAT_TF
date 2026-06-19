-- ═══════════════════════════════════════════════════════════════
-- 追加機能:
--  1) お気に入り（部員フォロー）
--  2) 大会・記録会の出場予定（各自が登録）
-- ═══════════════════════════════════════════════════════════════

-- ── 1) お気に入り ───────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  favorite_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, favorite_user_id)
);
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorites_select" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "favorites_insert" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "favorites_delete" ON favorites FOR DELETE USING (auth.uid() = user_id);
-- ── 2) 出場予定 ─────────────────────────────
CREATE TABLE IF NOT EXISTS competition_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,           -- 大会・記録会名
  event_date  DATE,                    -- 開催日
  events      TEXT,                    -- 出場種目（例: 1500m, 5000m）
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comp_entries_user ON competition_entries(user_id);
ALTER TABLE competition_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comp_entries_select" ON competition_entries FOR SELECT USING (TRUE);
CREATE POLICY "comp_entries_insert" ON competition_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comp_entries_update" ON competition_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "comp_entries_delete" ON competition_entries FOR DELETE USING (auth.uid() = user_id);
-- ── 3) 練習メニューは管理者も編集・削除できるように ──
DROP POLICY IF EXISTS "menus_update" ON practice_menus;
DROP POLICY IF EXISTS "menus_delete" ON practice_menus;
CREATE POLICY "menus_update" ON practice_menus FOR UPDATE
  USING (auth.uid() = author_id OR public.is_admin());
CREATE POLICY "menus_delete" ON practice_menus FOR DELETE
  USING (auth.uid() = author_id OR public.is_admin());

-- ═══════════════════════════════════════════════════════════════
-- お気に入り（部員フォロー）。既存環境でも安全に流せる冪等版。
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS favorites (
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  favorite_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, favorite_user_id)
);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorites_select" ON favorites;
DROP POLICY IF EXISTS "favorites_insert" ON favorites;
DROP POLICY IF EXISTS "favorites_delete" ON favorites;

CREATE POLICY "favorites_select" ON favorites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "favorites_insert" ON favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "favorites_delete" ON favorites FOR DELETE USING (auth.uid() = user_id);

-- スレッド（タスク17-b・オーナー確定 2026-07-13。掲示板スタイル: 誰でも作成・時系列返信）
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS thread_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_thread_posts_thread ON thread_posts(thread_id, created_at);

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_posts ENABLE ROW LEVEL SECURITY;

-- 閲覧は部員（authenticated）全員。作成は本人名義のみ。編集/削除は本人か管理者。
DROP POLICY IF EXISTS threads_select ON threads;
CREATE POLICY threads_select ON threads FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS threads_insert ON threads;
CREATE POLICY threads_insert ON threads FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
DROP POLICY IF EXISTS threads_update ON threads;
CREATE POLICY threads_update ON threads FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin())
  WITH CHECK (author_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS threads_delete ON threads;
CREATE POLICY threads_delete ON threads FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS thread_posts_select ON thread_posts;
CREATE POLICY thread_posts_select ON thread_posts FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS thread_posts_insert ON thread_posts;
CREATE POLICY thread_posts_insert ON thread_posts FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
DROP POLICY IF EXISTS thread_posts_update ON thread_posts;
CREATE POLICY thread_posts_update ON thread_posts FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
DROP POLICY IF EXISTS thread_posts_delete ON thread_posts;
CREATE POLICY thread_posts_delete ON thread_posts FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.is_admin());

-- 返信が付いたらスレッドを一覧の先頭へ（updated_at更新）
CREATE OR REPLACE FUNCTION touch_thread_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE threads SET updated_at = now() WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_thread_posts_touch ON thread_posts;
CREATE TRIGGER trg_thread_posts_touch
  AFTER INSERT ON thread_posts
  FOR EACH ROW EXECUTE FUNCTION touch_thread_updated_at();

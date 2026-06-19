-- コメント編集対応:
-- 1) 更新日時
-- 2) 本人のみ更新できるRLS
-- 3) 更新時刻の自動更新

ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP POLICY IF EXISTS "comments_update" ON comments;
CREATE POLICY "comments_update"
  ON comments
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_comments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_set_updated_at ON comments;
CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_comments_updated_at();

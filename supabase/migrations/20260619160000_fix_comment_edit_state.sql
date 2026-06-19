-- updated_at追加時に既存行へ現在時刻が入ったため、
-- 未編集コメントが「編集済み」になる状態を補正する。

DROP TRIGGER IF EXISTS comments_set_updated_at ON comments;

UPDATE comments
SET updated_at = created_at;

CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_comments_updated_at();

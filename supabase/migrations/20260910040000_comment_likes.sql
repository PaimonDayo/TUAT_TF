-- ═══════════════════════════════════════════════════════════════
-- コメントにもいいねを付けられるようにする
--   likes は (target_type, target_id) の多相テーブルなので、'comment' を許可するだけで足りる。
--   投稿（record / tweet）のいいねの挙動・データは変更しない。
--   スプレッドシート由来の返信（sheet_record_replies）は同期のたびに作り直されるため対象外。
-- ═══════════════════════════════════════════════════════════════

-- 既存の CHECK (target_type IN ('record','tweet')) を差し替える。
-- 制約名は環境で異なりうるので、target_type だけを見ている検査制約を探して外す。
DO $$
DECLARE target text;
BEGIN
  SELECT c.conname INTO target
    FROM pg_constraint c
   WHERE c.conrelid = 'public.likes'::regclass
     AND c.contype = 'c'
     AND (
       SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM unnest(c.conkey) AS k
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
     ) = ARRAY['target_type']::text[];
  IF target IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.likes DROP CONSTRAINT %I', target);
  END IF;
END $$;

ALTER TABLE public.likes DROP CONSTRAINT IF EXISTS likes_target_type_check;
ALTER TABLE public.likes ADD CONSTRAINT likes_target_type_check
  CHECK (target_type IN ('record', 'tweet', 'comment'));

-- いいねの付け外し。'comment' を受け付ける以外は従来どおり。
CREATE OR REPLACE FUNCTION public.set_like_state(
  target_type_in TEXT,
  target_id_in UUID,
  desired_liked BOOLEAN
)
RETURNS TABLE(liked BOOLEAN, likes_count BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  viewer_id UUID := auth.uid();
BEGIN
  IF viewer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF target_type_in NOT IN ('record', 'tweet', 'comment') THEN
    RAISE EXCEPTION 'Invalid target type' USING ERRCODE = '22023';
  END IF;

  IF desired_liked THEN
    INSERT INTO public.likes (user_id, target_type, target_id)
    VALUES (viewer_id, target_type_in, target_id_in)
    ON CONFLICT (user_id, target_type, target_id) DO NOTHING;
  ELSE
    DELETE FROM public.likes l
    WHERE l.user_id = viewer_id
      AND l.target_type = target_type_in
      AND l.target_id = target_id_in;
  END IF;

  RETURN QUERY
  SELECT
    EXISTS (
      SELECT 1 FROM public.likes l
      WHERE l.user_id = viewer_id
        AND l.target_type = target_type_in
        AND l.target_id = target_id_in
    ),
    COUNT(*)::BIGINT
  FROM public.likes l
  WHERE l.target_type = target_type_in
    AND l.target_id = target_id_in;
END;
$$;

REVOKE ALL ON FUNCTION public.set_like_state(TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_like_state(TEXT, UUID, BOOLEAN) TO authenticated;

-- コメント一覧を開いたときに、件数と自分の状態を1回でまとめて読む。
-- SECURITY INVOKER なので、コメント自体のRLSで見えるものだけが返る。
CREATE OR REPLACE FUNCTION public.get_comment_like_state(comment_ids UUID[])
RETURNS TABLE(comment_id UUID, likes_count BIGINT, liked_by_me BOOLEAN)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.id,
    (
      SELECT COUNT(*)::BIGINT FROM public.likes l
       WHERE l.target_type = 'comment' AND l.target_id = c.id
    ),
    EXISTS (
      SELECT 1 FROM public.likes l
       WHERE l.target_type = 'comment' AND l.target_id = c.id AND l.user_id = auth.uid()
    )
  FROM public.comments c
  WHERE c.id = ANY(COALESCE(comment_ids, ARRAY[]::UUID[]));
$$;

REVOKE ALL ON FUNCTION public.get_comment_like_state(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comment_like_state(UUID[]) TO authenticated;

-- likes は多相参照でFKを張れないので、コメント削除時にその分だけ後片付けする。
CREATE OR REPLACE FUNCTION public.comments_delete_likes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.likes
   WHERE target_type = 'comment' AND target_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS comments_delete_likes_trigger ON public.comments;
CREATE TRIGGER comments_delete_likes_trigger
AFTER DELETE ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.comments_delete_likes();

NOTIFY pgrst,'reload schema';

-- アプリの返信を削除したあと、その写しがスプレッドシート側の返信として復活するのを防ぐ。
--
-- アプリの返信は作者のスプレッドシートへ「{本文}　{投稿者名}」で書き出される。
-- 二重表示を避ける仕組みは「今あるアプリ返信の本文と列位置」を突き合わせているため、
-- アプリ側の返信を削除した瞬間にその手掛かりが消え、次の同期でシートのセルが
-- 「スプレッドシートからの返信」として取り込まれてしまっていた。
--
-- 削除された返信の痕跡（列位置と書き出した本文）を残し、取込時に除外する。
CREATE TABLE IF NOT EXISTS public.sheet_reply_tombstones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- practice_records への外部キーは張らない。記録ごと削除したときの
  -- カスケード中に子行を追加することになり、順序に依存するため。
  record_id UUID NOT NULL,
  reply_index INTEGER CHECK (reply_index >= 0),
  exported_text TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sheet_reply_tombstones_record
  ON public.sheet_reply_tombstones(record_id);

ALTER TABLE public.sheet_reply_tombstones ENABLE ROW LEVEL SECURITY;

-- 閲覧のみ。書き込みは下のトリガー（SECURITY DEFINER）だけが行う。
DROP POLICY IF EXISTS "sheet_reply_tombstones_select" ON public.sheet_reply_tombstones;
CREATE POLICY "sheet_reply_tombstones_select"
  ON public.sheet_reply_tombstones
  FOR SELECT
  TO authenticated
  USING (TRUE);

REVOKE ALL ON TABLE public.sheet_reply_tombstones FROM anon;

/**
 * 記録へのコメントが消えたら痕跡を残す。
 * 対象は「スプレッドシートへ書き出された可能性のある返信」だけに絞る
 * （列位置を持っている、または記録の持ち主がシート連携している場合）。
 */
CREATE OR REPLACE FUNCTION public.handle_comment_sheet_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  author_name TEXT;
  owner_linked BOOLEAN;
BEGIN
  IF OLD.target_type <> 'record' THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(btrim(p.sheet_name), '') <> ''
  INTO owner_linked
  FROM public.practice_records r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.id = OLD.target_id;

  IF OLD.sheet_reply_index IS NULL AND COALESCE(owner_linked, FALSE) = FALSE THEN
    RETURN OLD;
  END IF;

  SELECT btrim(COALESCE(p.display_name, '')) INTO author_name
  FROM public.profiles p
  WHERE p.id = OLD.user_id;

  INSERT INTO public.sheet_reply_tombstones (record_id, reply_index, exported_text)
  VALUES (
    OLD.target_id,
    OLD.sheet_reply_index,
    CASE
      WHEN COALESCE(author_name, '') <> '' THEN OLD.content || '　' || author_name
      ELSE OLD.content
    END
  );

  -- 取込済みの行が残っていれば同時に片付ける（この修正より前に復活した分）。
  IF OLD.sheet_reply_index IS NOT NULL THEN
    DELETE FROM public.sheet_record_replies
    WHERE record_id = OLD.target_id
      AND reply_index = OLD.sheet_reply_index;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS comments_sheet_tombstone ON public.comments;
CREATE TRIGGER comments_sheet_tombstone
  AFTER DELETE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_comment_sheet_tombstone();

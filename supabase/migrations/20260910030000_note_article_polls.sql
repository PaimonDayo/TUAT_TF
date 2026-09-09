-- ═══════════════════════════════════════════════════════════════
-- ノートの記事にも投票を付けられるようにする
--   つぶやきの投票（tweet_poll_*）はそのまま。ノート用に同じ形の表を足すだけで、
--   既存の投票データ・ポリシー・RPCには触れない。
--   閲覧・編集の可否はノート本体の can_view_note / can_edit_note に合わせる。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.note_articles
  ADD COLUMN IF NOT EXISTS poll_multiple boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS poll_anonymous boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS poll_allow_options boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.note_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.note_articles(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.note_poll_votes (
  option_id uuid NOT NULL REFERENCES public.note_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);

CREATE INDEX IF NOT EXISTS note_poll_options_article_idx
  ON public.note_poll_options (article_id, sort_order);
CREATE INDEX IF NOT EXISTS note_poll_votes_option_idx
  ON public.note_poll_votes (option_id);

ALTER TABLE public.note_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_poll_options_select ON public.note_poll_options;
CREATE POLICY note_poll_options_select ON public.note_poll_options
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.note_articles a
       WHERE a.id = article_id AND public.can_view_note(a.note_id)
    )
  );

-- 選択肢を足せるのは記事の作成者と、作成者が追加を許可した記事の閲覧者。
DROP POLICY IF EXISTS note_poll_options_insert ON public.note_poll_options;
CREATE POLICY note_poll_options_insert ON public.note_poll_options
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.note_articles a
       WHERE a.id = article_id
         AND public.can_view_note(a.note_id)
         AND (a.author_id = auth.uid() OR a.poll_allow_options)
    )
  );

DROP POLICY IF EXISTS note_poll_options_delete ON public.note_poll_options;
CREATE POLICY note_poll_options_delete ON public.note_poll_options
  FOR DELETE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.note_articles a
       WHERE a.id = article_id AND a.author_id = auth.uid()
    )
  );

-- 票そのものは本人の分だけ読める（集計は下の関数が返す）。
DROP POLICY IF EXISTS note_poll_votes_select_own ON public.note_poll_votes;
CREATE POLICY note_poll_votes_select_own ON public.note_poll_votes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS note_poll_votes_insert_own ON public.note_poll_votes;
CREATE POLICY note_poll_votes_insert_own ON public.note_poll_votes
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.note_poll_options o
        JOIN public.note_articles a ON a.id = o.article_id
       WHERE o.id = option_id AND public.can_view_note(a.note_id)
    )
  );

DROP POLICY IF EXISTS note_poll_votes_delete_own ON public.note_poll_votes;
CREATE POLICY note_poll_votes_delete_own ON public.note_poll_votes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.note_poll_options TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.note_poll_votes TO authenticated;

-- 記事ごとの選択肢と集計。記名投票のときだけ投票者を返す。
-- SECURITY DEFINER なので、閲覧できるノートの記事に限ることをここで確かめる。
CREATE OR REPLACE FUNCTION public.get_note_poll_options(article_ids uuid[])
RETURNS TABLE(article_id uuid, options jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id AS article_id,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'article_id', o.article_id,
          'text', o.text,
          'created_by', o.created_by,
          'sort_order', o.sort_order,
          'vote_count', (SELECT COUNT(*) FROM public.note_poll_votes v WHERE v.option_id = o.id),
          'voted_by_me', EXISTS (
            SELECT 1 FROM public.note_poll_votes v
             WHERE v.option_id = o.id AND v.user_id = auth.uid()
          ),
          'voters', CASE WHEN a.poll_anonymous THEN '[]'::jsonb ELSE COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'profile_id', p.id,
                'display_name', p.display_name,
                'avatar_url', p.avatar_url,
                'blocks', COALESCE(p.blocks, ARRAY[]::TEXT[]),
                'grade', p.grade
              )
              ORDER BY p.display_name, p.id
            )
            FROM public.note_poll_votes v
            JOIN public.profiles p ON p.id = v.user_id
            WHERE v.option_id = o.id
          ), '[]'::jsonb) END
        )
        ORDER BY o.sort_order, o.id
      )
      FROM public.note_poll_options o
      WHERE o.article_id = a.id
    ), '[]'::jsonb) AS options
  FROM public.note_articles a
  WHERE a.id = ANY(COALESCE(article_ids, ARRAY[]::uuid[]))
    AND public.can_view_note(a.note_id);
$$;

REVOKE ALL ON FUNCTION public.get_note_poll_options(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_note_poll_options(uuid[]) TO authenticated;

NOTIFY pgrst,'reload schema';

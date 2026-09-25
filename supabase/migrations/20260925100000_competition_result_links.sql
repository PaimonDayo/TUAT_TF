-- 27大戦の結果を、本名一致が機械的に確認できた部員だけへ紐付けて表示するためのテーブル。
-- competition_program_entries.tuat_entries（速報サイト由来・全件洗い替え）は同期のたびに
-- 行ごと作り直されるため、恒久的な紐付けはこの別テーブルへ保存する。
-- 初期公開はOB戦エントリーと同じくシステム管理権限のみ。一般部員への公開は別の明示的な変更とする。
CREATE TABLE IF NOT EXISTS public.competition_result_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id text NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_label text NOT NULL,
  entry_name text NOT NULL CHECK (length(btrim(entry_name)) BETWEEN 1 AND 100),
  entry_grade text,
  place text,
  record text,
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, profile_id, event_label, entry_name)
);

CREATE INDEX IF NOT EXISTS idx_competition_result_links_profile
  ON public.competition_result_links(profile_id, competition_id);

ALTER TABLE public.competition_result_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_result_links FROM anon, authenticated;
GRANT SELECT ON public.competition_result_links TO authenticated;
GRANT ALL ON public.competition_result_links TO service_role;

DROP POLICY IF EXISTS competition_result_links_system_read ON public.competition_result_links;
CREATE POLICY competition_result_links_system_read ON public.competition_result_links
  FOR SELECT TO authenticated USING (public.can_manage_system());

NOTIFY pgrst, 'reload schema';

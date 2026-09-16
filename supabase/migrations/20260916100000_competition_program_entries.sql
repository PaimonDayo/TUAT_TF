-- 大会プログラム（速報サイトから取り込んだ、農工大の出場種目・出場選手）。
-- competitions.program_source_url を設定した大会だけ、/api/competition-program/sync が
-- 外部の速報サイト（例: sairiku.net のタイムテーブル）を取り込む。全件洗い替え方式
-- （毎回そのcompetition_idの行を消してから入れ直す）なので、行の更新・削除ポリシーは
-- 不要（service roleがRLSを経由せず書き込む）。閲覧は全部員に開く。

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS program_source_url text;

CREATE TABLE IF NOT EXISTS public.competition_program_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id text NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  block text NOT NULL CHECK (block IN ('track','field')),
  sort_order integer NOT NULL DEFAULT 0,
  time_label text,
  round_key text,
  event_label text NOT NULL,
  status text,
  tuat_entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competition_program_entries_lookup
  ON public.competition_program_entries(competition_id, event_date, block, sort_order);

ALTER TABLE public.competition_program_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS competition_program_entries_read ON public.competition_program_entries;
CREATE POLICY competition_program_entries_read ON public.competition_program_entries
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.competition_program_entries TO authenticated;

NOTIFY pgrst, 'reload schema';

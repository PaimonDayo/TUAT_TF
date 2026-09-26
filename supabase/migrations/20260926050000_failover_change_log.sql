-- PCが止まっている間にクラウドSupabaseへ入った書き込みを記録し、PCの復帰後にPCへ書き戻すための記録
-- （予備構成、2026-09-26 オーナー依頼）。
--
-- - クラウドだけ failover_config.log_changes = true にする（PCは false のまま＝PCでは何も記録しない）。
-- - PC→クラウドの写し（x-tuat-mirror: 1）による書き込みは記録しない（is_mirror_write）。
-- - 記録は PC の ops/laptop/cloud-mirror.mjs が読み、PCへ書き戻してから消す。
-- - 追加は行全体、更新は変わった列だけ、削除は主キーだけを書き戻す（クラウドに古い行があっても、
--   変わっていない列でPCを上書きしないため）。
-- - トリガーの副作用で作られる行（通知・記録フォームの版・スプシ同期の管理表など）は記録しない。
--   書き戻しは通常の書き込みとしてPCのトリガーを動かすので、PCで同じものが作られる。
-- PCとクラウドの構造をそろえるため両方に当てる。新しく表を作ったときは、下の一覧に当てはまるか確認すること。

CREATE TABLE IF NOT EXISTS public.failover_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  log_changes boolean NOT NULL DEFAULT false
);
INSERT INTO public.failover_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.failover_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.failover_config FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.failover_changes (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  pk jsonb NOT NULL,
  row_data jsonb,
  changed text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
ALTER TABLE public.failover_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.failover_changes FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.failover_changes_id_seq FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_failover_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_row jsonb;
  old_row jsonb;
  key jsonb := '{}'::jsonb;
  col text;
  diff text[];
BEGIN
  IF public.is_mirror_write() THEN RETURN NULL; END IF;
  IF NOT coalesce((SELECT log_changes FROM public.failover_config WHERE id), false) THEN RETURN NULL; END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    key := key || jsonb_build_object(col, coalesce(new_row, old_row) -> col);
  END LOOP;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key) INTO diff FROM jsonb_each(new_row) n WHERE (old_row -> n.key) IS DISTINCT FROM n.value;
    IF diff IS NULL THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO public.failover_changes (table_name, op, pk, row_data, changed)
  VALUES (TG_TABLE_NAME, TG_OP, key, new_row, diff);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_failover_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname,
           (SELECT string_agg(quote_literal(a.attname), ', ' ORDER BY array_position(i.indkey, a.attnum))
              FROM pg_index i JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
             WHERE i.indrelid = c.oid AND i.indisprimary) AS pk
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND c.relname NOT IN (
         'failover_changes', 'failover_config',
         -- トリガーの副作用や同期の管理表（PCのトリガー・同期がPC側で作り直す）
         'notifications', 'record_form_config_versions', 'ob_entry_changes',
         'sheet_sync_runs', 'sheet_sync_state', 'sheet_member_sync_state', 'sheet_pending_clears', 'sheet_record_replies',
         'note_image_cleanup',
         -- 秘密情報（クラウドへは写さない）
         'google_drive_connections')
  LOOP
    IF t.pk IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_log_failover_change ON public.%I', t.relname);
    EXECUTE format('CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_failover_change(%s)', t.relname, t.pk);
  END LOOP;
END;
$$;

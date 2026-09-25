-- アプリで練習記録を消した（または日付を変えた）とき、スプシの同じ日の欄も空にする（2026-09-26 オーナー確定）。
-- 空にする予定をここへ残し、すぐの書き込み（/api/sheets/clear-deleted）と毎日0時の同期が処理する。
-- 予定が残っている間、同期はその日をスプシから取り込まない（消した記録が復活しないように）。
CREATE TABLE IF NOT EXISTS public.sheet_pending_clears (
  user_id uuid NOT NULL,
  recorded_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recorded_date)
);
COMMENT ON TABLE public.sheet_pending_clears IS
  'アプリで消した・日付を変えた練習記録について、スプシの同じ日の欄を空にする予定。書き込めたら行を消す';

-- 同期（service_role）だけが読み書きする。部員には見せない。
ALTER TABLE public.sheet_pending_clears ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sheet_pending_clears FROM anon, authenticated;
GRANT ALL ON public.sheet_pending_clears TO service_role;

CREATE OR REPLACE FUNCTION public.queue_sheet_row_clear()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.recorded_date IS NOT DISTINCT FROM OLD.recorded_date THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = OLD.user_id AND NULLIF(BTRIM(sheet_name), '') IS NOT NULL
  ) THEN
    INSERT INTO public.sheet_pending_clears (user_id, recorded_date)
    VALUES (OLD.user_id, OLD.recorded_date)
    ON CONFLICT (user_id, recorded_date) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_sheet_row_clear() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_queue_sheet_row_clear_delete ON public.practice_records;
CREATE TRIGGER trg_queue_sheet_row_clear_delete
  AFTER DELETE ON public.practice_records
  FOR EACH ROW EXECUTE FUNCTION public.queue_sheet_row_clear();

DROP TRIGGER IF EXISTS trg_queue_sheet_row_clear_move ON public.practice_records;
CREATE TRIGGER trg_queue_sheet_row_clear_move
  AFTER UPDATE OF recorded_date ON public.practice_records
  FOR EACH ROW EXECUTE FUNCTION public.queue_sheet_row_clear();

NOTIFY pgrst, 'reload schema';

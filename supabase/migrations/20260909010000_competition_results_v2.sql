-- ═══════════════════════════════════════════════════════════════
-- 大会・記録会の結果の入力統一（Phase 1-3 の土台）
--   - competitions        : 部で統一する大会のマスタへ拡張（管理者が追加・編集・削除）
--   - competition_events  : 種目ごとの記録の測り方（時間/距離/得点）
--   - pb_records          : 大会の紐付け・入力段階（大学/大学以前）・日付の粒度・
--                           構造化した記録値・風速・記録なしの状態
--   既存の列（event_name / record / meet_name / recorded_on）は保持したまま列を追加するだけ。
--   既存データの正規化は別途 dry-run のうえで行う。
-- ═══════════════════════════════════════════════════════════════

-- ── 大会マスタ ────────────────────────────────────────────────
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS ends_on date,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_countdown boolean NOT NULL DEFAULT false;

UPDATE public.competitions SET is_countdown = true
WHERE id = '27-universities-2026'
  AND NOT EXISTS (SELECT 1 FROM public.competitions WHERE is_countdown);

-- ホームのカウントダウンに出す大会は同時に1つだけ。
CREATE UNIQUE INDEX IF NOT EXISTS competitions_single_countdown
  ON public.competitions ((is_countdown)) WHERE is_countdown;

DROP POLICY IF EXISTS competitions_insert ON public.competitions;
CREATE POLICY competitions_insert ON public.competitions FOR INSERT TO authenticated
WITH CHECK (public.can_manage_system());
DROP POLICY IF EXISTS competitions_delete ON public.competitions;
CREATE POLICY competitions_delete ON public.competitions FOR DELETE TO authenticated
USING (public.can_manage_system());
GRANT INSERT, DELETE ON public.competitions TO authenticated;

-- ── 種目マスタ ────────────────────────────────────────────────
ALTER TABLE public.competition_events
  ADD COLUMN IF NOT EXISTS measure_type text NOT NULL DEFAULT 'time'
    CHECK (measure_type IN ('time','distance','points'));

UPDATE public.competition_events SET measure_type = 'distance'
WHERE measure_type = 'time'
  AND name IN ('走高跳','棒高跳','走幅跳','三段跳','砲丸投','円盤投','ハンマー投','やり投');
UPDATE public.competition_events SET measure_type = 'points'
WHERE measure_type = 'time' AND name IN ('七種競技','十種競技');

-- ── 結果 ──────────────────────────────────────────────────────
ALTER TABLE public.pb_records
  ADD COLUMN IF NOT EXISTS competition_id text REFERENCES public.competitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'university'
    CHECK (stage IN ('university','pre_university')),
  ADD COLUMN IF NOT EXISTS date_precision text NOT NULL DEFAULT 'day'
    CHECK (date_precision IN ('day','month','year')),
  ADD COLUMN IF NOT EXISTS result_status text NOT NULL DEFAULT 'ok'
    CHECK (result_status IN ('ok','DNS','DNF','DQ','NM')),
  ADD COLUMN IF NOT EXISTS wind numeric(3,1) CHECK (wind BETWEEN -20 AND 20),
  ADD COLUMN IF NOT EXISTS value_cs integer CHECK (value_cs >= 0),
  ADD COLUMN IF NOT EXISTS value_cm integer CHECK (value_cm >= 0),
  ADD COLUMN IF NOT EXISTS value_points integer CHECK (value_points >= 0);

CREATE INDEX IF NOT EXISTS pb_records_competition_idx ON public.pb_records (competition_id);
CREATE INDEX IF NOT EXISTS pb_records_user_event_idx ON public.pb_records (user_id, event_name);

-- 種目ごとに PB / UB は1件だけ。新しく印を付けた行が勝ち、同じ種目の他の行から外す。
CREATE OR REPLACE FUNCTION public.pb_records_single_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_pb THEN
    UPDATE public.pb_records SET is_pb = false
    WHERE user_id = NEW.user_id AND event_name = NEW.event_name AND id <> NEW.id AND is_pb;
  END IF;
  IF NEW.is_ub THEN
    UPDATE public.pb_records SET is_ub = false
    WHERE user_id = NEW.user_id AND event_name = NEW.event_name AND id <> NEW.id AND is_ub;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS pb_records_single_flag_trigger ON public.pb_records;
CREATE TRIGGER pb_records_single_flag_trigger
AFTER INSERT OR UPDATE OF is_pb, is_ub, event_name ON public.pb_records
FOR EACH ROW WHEN (NEW.is_pb OR NEW.is_ub)
EXECUTE FUNCTION public.pb_records_single_flag();

-- 種目名を変えたら結果側の表記も追従させる（目標は FK の ON UPDATE CASCADE で追従）。
CREATE OR REPLACE FUNCTION public.competition_events_rename()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.pb_records SET event_name = NEW.name WHERE event_name = OLD.name;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS competition_events_rename_trigger ON public.competition_events;
CREATE TRIGGER competition_events_rename_trigger
AFTER UPDATE OF name ON public.competition_events
FOR EACH ROW EXECUTE FUNCTION public.competition_events_rename();

-- ── システム管理者は表記統一のため他の部員の結果も編集できる ──
DROP POLICY IF EXISTS "pb_insert" ON public.pb_records;
CREATE POLICY "pb_insert" ON public.pb_records FOR INSERT
WITH CHECK (auth.uid() = user_id OR public.can_manage_system());
DROP POLICY IF EXISTS "pb_update" ON public.pb_records;
CREATE POLICY "pb_update" ON public.pb_records FOR UPDATE
USING (auth.uid() = user_id OR public.can_manage_system());
DROP POLICY IF EXISTS "pb_delete" ON public.pb_records;
CREATE POLICY "pb_delete" ON public.pb_records FOR DELETE
USING (auth.uid() = user_id OR public.can_manage_system());

NOTIFY pgrst,'reload schema';

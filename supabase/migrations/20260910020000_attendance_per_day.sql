-- ═══════════════════════════════════════════════════════════════
-- 複数日開催（大会・記録会など）の出欠を日ごとに提出できるようにする
--   これまでは (schedule_id, user_id) が一意で、1つの予定につき1回しか
--   出欠を出せなかった。2日目以降を別々に提出できるよう attend_date を追加する。
--   既存の行は開催初日の出欠として扱う（値は変えない）。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.attendances ADD COLUMN IF NOT EXISTS attend_date date;

-- 既存行は「その予定の開催日の出欠」。内容は変更しない。
UPDATE public.attendances a
   SET attend_date = s.schedule_date
  FROM public.practice_schedules s
 WHERE a.schedule_id = s.id
   AND a.attend_date IS NULL;

ALTER TABLE public.attendances ALTER COLUMN attend_date SET NOT NULL;

-- 旧 UNIQUE (schedule_id, user_id) を外す。制約名は環境で異なりうるので列の組で探す。
DO $$
DECLARE target text;
BEGIN
  SELECT c.conname INTO target
    FROM pg_constraint c
   WHERE c.conrelid = 'public.attendances'::regclass
     AND c.contype = 'u'
     AND (
       SELECT array_agg(a.attname ORDER BY a.attname)
         FROM unnest(c.conkey) AS k
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
     ) = ARRAY['schedule_id', 'user_id'];
  IF target IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.attendances DROP CONSTRAINT %I', target);
  END IF;
END $$;

ALTER TABLE public.attendances
  DROP CONSTRAINT IF EXISTS attendances_schedule_user_date_key;
ALTER TABLE public.attendances
  ADD CONSTRAINT attendances_schedule_user_date_key
  UNIQUE (schedule_id, user_id, attend_date);

-- 開催期間の外の日付を書けないようにする（クライアントからの任意日付を防ぐ）。
-- 期間を後から縮めた場合の既存行はそのまま残る（画面は期間内の日だけを読む）。
CREATE OR REPLACE FUNCTION public.attendances_check_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE starts_on date; ends_on date;
BEGIN
  SELECT s.schedule_date, COALESCE(s.end_date, s.schedule_date)
    INTO starts_on, ends_on
    FROM public.practice_schedules s
   WHERE s.id = NEW.schedule_id;
  IF starts_on IS NULL THEN
    RAISE EXCEPTION '予定が見つかりません';
  END IF;
  IF NEW.attend_date < starts_on OR NEW.attend_date > ends_on THEN
    RAISE EXCEPTION '出欠の日付が開催期間の外です';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendances_check_date_trigger ON public.attendances;
CREATE TRIGGER attendances_check_date_trigger
BEFORE INSERT OR UPDATE OF attend_date, schedule_id ON public.attendances
FOR EACH ROW EXECUTE FUNCTION public.attendances_check_date();

NOTIFY pgrst,'reload schema';

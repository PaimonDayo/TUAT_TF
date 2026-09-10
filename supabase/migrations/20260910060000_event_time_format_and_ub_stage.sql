-- ═══════════════════════════════════════════════════════════════
-- 種目ごとの「記録の書き方」と、高校以前に大学ベストを付けさせない制約
--   ・短距離は 61.85 のように秒で書き、長距離は 15分32.40 と分けて書く。
--     どちらで書くかは種目によって違うので、種目マスタに持たせて管理者が選ぶ。
--   ・UB（大学ベスト）は大学の記録に対する印なので、高校以前には付かない。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.competition_events
  ADD COLUMN IF NOT EXISTS time_format text NOT NULL DEFAULT 'minutes'
    CHECK (time_format IN ('minutes', 'seconds'));

-- 400mまでの種目は秒で書くのが普通なので、その形を最初から入れておく。
-- 合わない種目があれば管理メニューの「種目」から1件ずつ変えられる。
UPDATE public.competition_events
   SET time_format = 'seconds'
 WHERE measure_type = 'time'
   AND name IN ('100m', '200m', '400m', '100mH', '110mH', '400mH', '4×100mR', '4×400mR');

-- 高校以前に付いている大学ベストの印を落とす（記録そのものは残す）。
UPDATE public.pb_records
   SET is_ub = false
 WHERE stage = 'pre_university' AND is_ub;

ALTER TABLE public.pb_records DROP CONSTRAINT IF EXISTS pb_records_ub_university_only;
ALTER TABLE public.pb_records
  ADD CONSTRAINT pb_records_ub_university_only
  CHECK (NOT (is_ub AND stage = 'pre_university'));

NOTIFY pgrst,'reload schema';

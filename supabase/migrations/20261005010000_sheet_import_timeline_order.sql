-- The owner switched sheet posts to import-time ordering on 2026-09-13.
-- Remove the earlier practice-midnight enforcement for every insert/update path.
-- Existing failover logging and the full-column mirror already cover this table.
DROP TRIGGER IF EXISTS trg_enforce_sheet_record_created_at ON public.practice_records;
DROP FUNCTION IF EXISTS public.enforce_sheet_record_created_at();

-- Repair only the old forced timestamps with a known sync after that instruction.
-- Keep earlier history and app-authored posts; never invent a current import time.
UPDATE public.practice_records
SET created_at = synced_at - LEAST(GREATEST(
  (synced_at AT TIME ZONE 'Asia/Tokyo')::date - recorded_date, 0
), 1000) * INTERVAL '1 millisecond'
WHERE from_sheet = TRUE
  AND synced_at >= TIMESTAMPTZ '2026-09-13 00:00:00+09'
  AND created_at = (recorded_date::text || ' 00:00:00+09')::timestamptz;

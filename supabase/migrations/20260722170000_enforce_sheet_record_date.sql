-- Order sheet-imported practice records by their practice date, not their import time.
-- Repair existing rows and enforce the same rule for every import path.

CREATE OR REPLACE FUNCTION public.enforce_sheet_record_created_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.from_sheet = TRUE THEN
    NEW.created_at := (NEW.recorded_date::text || ' 00:00:00+09')::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sheet_record_created_at
  ON public.practice_records;

CREATE TRIGGER trg_enforce_sheet_record_created_at
BEFORE INSERT OR UPDATE OF recorded_date, from_sheet
ON public.practice_records
FOR EACH ROW
EXECUTE FUNCTION public.enforce_sheet_record_created_at();

UPDATE public.practice_records
SET created_at = (recorded_date::text || ' 00:00:00+09')::timestamptz
WHERE from_sheet = TRUE
  AND created_at IS DISTINCT FROM
    (recorded_date::text || ' 00:00:00+09')::timestamptz;

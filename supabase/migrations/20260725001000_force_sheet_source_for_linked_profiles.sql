-- Linked practice-record sheets are always authoritative.
-- App form submissions still write through to the linked sheet.
CREATE OR REPLACE FUNCTION public.force_linked_profile_record_source()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NULLIF(BTRIM(NEW.sheet_name), '') IS NULL THEN
    NEW.record_source := 'app';
  ELSE
    NEW.record_source := 'sheet';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_linked_profile_record_source ON public.profiles;
CREATE TRIGGER trg_force_linked_profile_record_source
BEFORE INSERT OR UPDATE OF sheet_name, record_source ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.force_linked_profile_record_source();

UPDATE public.profiles
SET record_source = 'sheet'
WHERE NULLIF(BTRIM(sheet_name), '') IS NOT NULL
  AND record_source IS DISTINCT FROM 'sheet';

UPDATE public.profiles
SET record_source = 'app'
WHERE NULLIF(BTRIM(sheet_name), '') IS NULL
  AND record_source IS DISTINCT FROM 'app';

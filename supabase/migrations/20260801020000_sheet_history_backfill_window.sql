ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sheet_history_imported_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.sheet_history_imported_at IS
  'Full spreadsheet history was imported successfully. NULL triggers a one-time backfill from the sheet start date.';

CREATE OR REPLACE FUNCTION public.set_sheet_linked_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.sheet_name, '') = '' THEN
    NEW.sheet_linked_at := NULL;
    NEW.sheet_history_imported_at := NULL;
  ELSIF COALESCE(NEW.sheet_name, '') <> COALESCE(OLD.sheet_name, '') THEN
    NEW.sheet_linked_at := (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE;
    NEW.sheet_history_imported_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

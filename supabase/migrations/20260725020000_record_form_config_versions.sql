-- Version record-form settings and preserve the schema used by every practice record.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS record_fields_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.practice_records
  ADD COLUMN IF NOT EXISTS record_fields_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS record_fields_version integer;

CREATE TABLE IF NOT EXISTS public.record_form_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'sheet')),
  sheet_header_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

ALTER TABLE public.record_form_config_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "record_form_config_versions_select_own" ON public.record_form_config_versions;
CREATE POLICY "record_form_config_versions_select_own"
  ON public.record_form_config_versions
  FOR SELECT
  USING (auth.uid() = profile_id);

CREATE OR REPLACE FUNCTION public.version_record_form_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.record_fields IS DISTINCT FROM OLD.record_fields THEN
    NEW.record_fields_version := OLD.record_fields_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_version_record_form_config ON public.profiles;
CREATE TRIGGER trg_version_record_form_config
BEFORE UPDATE OF record_fields ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.version_record_form_config();

CREATE OR REPLACE FUNCTION public.archive_record_form_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.record_fields IS DISTINCT FROM OLD.record_fields THEN
    INSERT INTO public.record_form_config_versions (
      profile_id,
      version,
      fields,
      source,
      sheet_header_signature
    ) VALUES (
      NEW.id,
      NEW.record_fields_version,
      NEW.record_fields,
      CASE WHEN NULLIF(BTRIM(NEW.sheet_name), '') IS NULL THEN 'app' ELSE 'sheet' END,
      NEW.sheet_header_signature
    )
    ON CONFLICT (profile_id, version) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_record_form_config ON public.profiles;
CREATE TRIGGER trg_archive_record_form_config
AFTER UPDATE OF record_fields ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.archive_record_form_config();

INSERT INTO public.record_form_config_versions (
  profile_id,
  version,
  fields,
  source,
  sheet_header_signature,
  created_at
)
SELECT
  id,
  record_fields_version,
  record_fields,
  CASE WHEN NULLIF(BTRIM(sheet_name), '') IS NULL THEN 'app' ELSE 'sheet' END,
  sheet_header_signature,
  now()
FROM public.profiles
ON CONFLICT (profile_id, version) DO NOTHING;

UPDATE public.practice_records AS record
SET
  record_fields_snapshot = profile.record_fields,
  record_fields_version = profile.record_fields_version
FROM public.profiles AS profile
WHERE profile.id = record.user_id
  AND record.record_fields_snapshot IS NULL;

CREATE OR REPLACE FUNCTION public.set_practice_record_field_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.record_fields_snapshot IS NULL OR NEW.record_fields_version IS NULL THEN
    SELECT record_fields, record_fields_version
    INTO NEW.record_fields_snapshot, NEW.record_fields_version
    FROM public.profiles
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_practice_record_field_snapshot ON public.practice_records;
CREATE TRIGGER trg_set_practice_record_field_snapshot
BEFORE INSERT ON public.practice_records
FOR EACH ROW
EXECUTE FUNCTION public.set_practice_record_field_snapshot();

CREATE INDEX IF NOT EXISTS idx_record_form_config_versions_profile_created
  ON public.record_form_config_versions(profile_id, created_at DESC);

COMMENT ON COLUMN public.practice_records.record_fields_snapshot IS
  'Record-form and timeline field configuration captured when the record was created.';
COMMENT ON COLUMN public.practice_records.record_fields_version IS
  'Version of profiles.record_fields used when the record was created.';
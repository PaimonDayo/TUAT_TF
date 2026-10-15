-- Save another member's sheet setup without changing general profile UPDATE permissions.
-- Existing profile versioning, failover logging, and mirror handling remain in place.
CREATE OR REPLACE FUNCTION public.admin_save_member_sheet_setup(
  p_profile_id uuid,
  p_expected jsonb,
  p_sheet_name text,
  p_fields jsonb,
  p_signature text,
  p_mode text
)
RETURNS TABLE(id uuid, record_fields_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prior public.profiles%ROWTYPE;
  current_state jsonb;
  legacy jsonb;
  saved_id uuid;
  saved_version integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required' USING ERRCODE = '42501';
  END IF;
  IF p_profile_id IS NULL OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
     OR p_mode IS NULL OR p_mode NOT IN ('sheet', 'app_only', 'off') THEN
    RAISE EXCEPTION 'invalid sheet settings' USING ERRCODE = '22023';
  END IF;
  IF p_mode <> 'off' THEN
    IF NULLIF(btrim(p_sheet_name), '') IS NULL OR NULLIF(btrim(p_signature), '') IS NULL
       OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'sheet, fields, and signature are required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_fields) AS item(field)
      WHERE jsonb_typeof(item.field) IS DISTINCT FROM 'object'
         OR jsonb_typeof(item.field->'key') IS DISTINCT FROM 'string'
         OR NULLIF(btrim(item.field->>'key'), '') IS NULL
         OR jsonb_typeof(item.field->'label') IS DISTINCT FROM 'string'
         OR NULLIF(btrim(item.field->>'label'), '') IS NULL
         OR COALESCE(item.field->>'type', '') NOT IN ('text', 'number')
         OR jsonb_typeof(item.field->'sourceHeader') IS DISTINCT FROM 'string'
         OR jsonb_typeof(item.field->'sourceColumn') IS DISTINCT FROM 'number'
         OR (item.field->>'sourceColumn') !~ '^[0-9]+$'
         OR jsonb_typeof(item.field->'showInTimeline') IS DISTINCT FROM 'boolean'
         OR (item.field ? 'hidden' AND jsonb_typeof(item.field->'hidden') IS DISTINCT FROM 'boolean')
    ) THEN
      RAISE EXCEPTION 'invalid field definition' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT profile.* INTO prior FROM public.profiles AS profile
  WHERE profile.id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'P0002';
  END IF;
  current_state := jsonb_build_object(
    'id', prior.id,
    'blocks', prior.blocks,
    'sheet_name', prior.sheet_name,
    'record_fields', prior.record_fields,
    'record_fields_version', prior.record_fields_version,
    'sheet_header_signature', prior.sheet_header_signature,
    'sheet_transition', prior.sheet_transition,
    'record_source', prior.record_source
  );
  IF p_expected IS DISTINCT FROM current_state THEN
    RAISE EXCEPTION 'sheet settings changed' USING ERRCODE = 'PT409';
  END IF;

  legacy := CASE WHEN prior.sheet_transition->>'version' = '2026-10'
    THEN prior.sheet_transition->'legacy'
    ELSE jsonb_build_object(
      'sheet_name', prior.sheet_name,
      'record_fields', COALESCE(prior.record_fields, '[]'::jsonb),
      'sheet_header_signature', prior.sheet_header_signature,
      'record_source', prior.record_source,
      'record_fields_version', prior.record_fields_version
    ) END;
  UPDATE public.profiles AS profile SET
    sheet_name = CASE WHEN p_mode = 'off' THEN prior.sheet_name ELSE btrim(p_sheet_name) END,
    record_fields = CASE WHEN p_mode = 'off' THEN prior.record_fields ELSE p_fields END,
    sheet_header_signature = CASE WHEN p_mode = 'off' THEN prior.sheet_header_signature ELSE p_signature END,
    sheet_history_imported_at = NULL,
    record_source = CASE WHEN p_mode IN ('app_only', 'off') THEN 'app' ELSE 'sheet' END,
    sheet_transition = jsonb_build_object(
      'version', '2026-10', 'mode', p_mode, 'confirmed_at', now(), 'legacy', legacy
    )
  WHERE profile.id = p_profile_id
  RETURNING profile.id, profile.record_fields_version INTO saved_id, saved_version;
  DELETE FROM public.sheet_member_sync_state AS state WHERE state.profile_id = p_profile_id;
  RETURN QUERY SELECT saved_id, saved_version;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_member_sheet_setup(uuid, jsonb, text, jsonb, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_member_sheet_setup(uuid, jsonb, text, jsonb, text, text) TO authenticated;

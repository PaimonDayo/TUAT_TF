-- Existing profiles failover logging and full-column mirror cover this setting. No new table.
CREATE OR REPLACE FUNCTION public.force_linked_profile_record_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NULLIF(BTRIM(NEW.sheet_name), '') IS NULL OR
    (NEW.sheet_transition->>'version' = '2026-10' AND NEW.sheet_transition->>'mode' IN ('app_only','off')) THEN
    NEW.record_source := 'app';
  ELSE NEW.record_source := 'sheet'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_october_sheet_setup(p_sheet_name text, p_fields jsonb, p_signature text, p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prior public.profiles; legacy jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'System role required'; END IF;
  IF p_mode NOT IN ('sheet','app_only','off') OR p_mode IS NULL OR (p_mode <> 'off' AND
    (NULLIF(btrim(p_sheet_name),'') IS NULL OR NULLIF(p_signature,'') IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array')) THEN
    RAISE EXCEPTION 'Invalid sheet settings';
  END IF;
  SELECT * INTO STRICT prior FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
  legacy := CASE WHEN prior.sheet_transition->>'version'='2026-10' THEN prior.sheet_transition->'legacy'
    ELSE jsonb_build_object('sheet_name',prior.sheet_name,'record_fields',coalesce(prior.record_fields,'[]'::jsonb),
      'sheet_header_signature',prior.sheet_header_signature,'record_source',prior.record_source,'record_fields_version',prior.record_fields_version) END;
  UPDATE public.profiles SET sheet_name=CASE WHEN p_mode='off' THEN prior.sheet_name ELSE btrim(p_sheet_name) END,
    record_fields=CASE WHEN p_mode='off' THEN prior.record_fields ELSE p_fields END,
    sheet_header_signature=CASE WHEN p_mode='off' THEN prior.sheet_header_signature ELSE p_signature END, sheet_history_imported_at=NULL,
    record_source=CASE WHEN p_mode IN ('app_only','off') THEN 'app' ELSE 'sheet' END,
    sheet_transition=jsonb_build_object('version','2026-10','mode',p_mode,'confirmed_at',now(),'legacy',legacy)
  WHERE id=auth.uid();
  DELETE FROM public.sheet_member_sync_state WHERE profile_id=auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.save_october_sheet_setup(text,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_october_sheet_setup(text,jsonb,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_app_only_sheet_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb; importing boolean;
BEGIN
 IF public.is_mirror_write() THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' THEN
   -- A service-key synchronization must not remove replies after switching to app-only.
   -- Explicit user moderation still works through the authenticated deletion RPC.
   IF coalesce(auth.role(),'') <> 'service_role' THEN RETURN OLD; END IF;
   SELECT sheet_transition INTO cfg FROM public.profiles WHERE id=OLD.owner_id FOR SHARE;
   IF cfg->>'mode' IN ('app_only','off') THEN RAISE EXCEPTION 'Sheet import disabled by app-only input setting'; END IF;
   RETURN OLD;
 END IF;
 IF TG_TABLE_NAME='practice_records' THEN
   IF TG_OP='INSERT' THEN importing:=NEW.from_sheet;
   ELSE importing:=NEW.synced_at IS DISTINCT FROM OLD.synced_at AND
     (to_jsonb(NEW)-ARRAY['synced_at','updated_at','pending_sheet_push']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['synced_at','updated_at','pending_sheet_push']); END IF;
   IF NOT importing THEN RETURN NEW; END IF;
   SELECT sheet_transition INTO cfg FROM public.profiles WHERE id=NEW.user_id FOR SHARE;
 ELSE
   SELECT sheet_transition INTO cfg FROM public.profiles WHERE id=NEW.owner_id FOR SHARE;
 END IF;
 IF cfg->>'mode' IN ('app_only','off') THEN RAISE EXCEPTION 'Sheet import disabled by app-only input setting'; END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.set_practice_record_field_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.is_mirror_write() THEN RETURN NEW; END IF;
 IF NEW.record_fields_snapshot IS NULL OR NEW.record_fields_version IS NULL THEN
   SELECT CASE WHEN NEW.recorded_date < DATE '2026-10-01' AND sheet_transition->>'version'='2026-10' AND sheet_transition->>'mode'<>'off'
     THEN sheet_transition->'legacy'->'record_fields' ELSE record_fields END,
     CASE WHEN NEW.recorded_date < DATE '2026-10-01' AND sheet_transition->>'version'='2026-10' AND sheet_transition->>'mode'<>'off'
     THEN coalesce((sheet_transition->'legacy'->>'record_fields_version')::integer,record_fields_version)
     ELSE record_fields_version END
   INTO NEW.record_fields_snapshot,NEW.record_fields_version FROM public.profiles WHERE id=NEW.user_id;
 END IF;
 RETURN NEW;
END;
$$;

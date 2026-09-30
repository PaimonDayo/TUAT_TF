-- profiles already has failover logging and full-column mirror replication; no new table.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sheet_transition jsonb;

CREATE OR REPLACE FUNCTION public.guard_sheet_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.sheet_transition IS DISTINCT FROM OLD.sheet_transition
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'Sheet period settings must be saved through the setup function';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_sheet_transition ON public.profiles;
CREATE TRIGGER trg_guard_sheet_transition BEFORE INSERT OR UPDATE OF sheet_transition ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_sheet_transition();

CREATE OR REPLACE FUNCTION public.force_linked_profile_record_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NULLIF(BTRIM(NEW.sheet_name), '') IS NULL OR
    (NEW.sheet_transition->>'version' = '2026-10' AND NEW.sheet_transition->>'mode' = 'app_only') THEN
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
  IF p_mode NOT IN ('sheet','app_only') OR p_mode IS NULL OR NULLIF(btrim(p_sheet_name),'') IS NULL
    OR NULLIF(p_signature,'') IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid sheet settings';
  END IF;
  SELECT * INTO STRICT prior FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
  legacy := CASE WHEN prior.sheet_transition->>'version'='2026-10' THEN prior.sheet_transition->'legacy'
    ELSE jsonb_build_object('sheet_name',prior.sheet_name,'record_fields',coalesce(prior.record_fields,'[]'::jsonb),
      'sheet_header_signature',prior.sheet_header_signature,'record_source',prior.record_source,'record_fields_version',prior.record_fields_version) END;
  UPDATE public.profiles SET sheet_name=btrim(p_sheet_name), record_fields=p_fields,
    sheet_header_signature=p_signature, sheet_history_imported_at=NULL,
    record_source=CASE WHEN p_mode='app_only' THEN 'app' ELSE 'sheet' END,
    sheet_transition=jsonb_build_object('version','2026-10','mode',p_mode,'confirmed_at',now(),'legacy',legacy)
  WHERE id=auth.uid();
  DELETE FROM public.sheet_member_sync_state WHERE profile_id=auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.save_october_sheet_setup(text,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_october_sheet_setup(text,jsonb,text,text) TO authenticated;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
 CHECK (type IN ('comment','notice','schedule_update','sync_failure','thread_reply','mention','sheet_setup'));
INSERT INTO public.notifications (id,user_id,type,reference_id,reference_type)
SELECT md5('october-sheet-setup-2026:'||p.id::text)::uuid,p.id,'sheet_setup',p.id,NULL
FROM public.profiles p WHERE EXISTS (
 SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
 WHERE pr.profile_id=p.id AND r.can_manage_system
) ON CONFLICT (id) DO NOTHING;

-- Persist the workbook with each deletion receipt so later profile edits cannot reroute a deletion.
ALTER TABLE public.sheet_reply_deletions ADD COLUMN IF NOT EXISTS spreadsheet_id text;
ALTER TABLE public.sheet_reply_deletions ADD COLUMN IF NOT EXISTS legacy_period boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.route_sheet_reply_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb; system_member boolean;
BEGIN
 IF public.is_mirror_write() THEN RETURN NEW; END IF;
 SELECT p.sheet_transition, EXISTS(SELECT 1 FROM public.profile_roles pr JOIN public.roles role ON role.id=pr.role_id
   WHERE pr.profile_id=p.id AND role.can_manage_system)
 INTO cfg,system_member FROM public.practice_records r JOIN public.profiles p ON p.id=r.user_id WHERE r.id=NEW.record_id;
 IF coalesce(system_member,false) OR cfg->>'version'='2026-10' THEN
   IF NEW.recorded_date < DATE '2026-10-01' THEN
     NEW.legacy_period:=true;
     NEW.sheet_name:=coalesce(cfg->'legacy'->>'sheet_name',NEW.sheet_name);
   ELSIF cfg->>'version'='2026-10' THEN
     NEW.spreadsheet_id:='18HKZrVL-JtXbZ9zcYUFPRPGIGCpd7ltLOsmvBKdJfR8';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_route_sheet_reply_deletion ON public.sheet_reply_deletions;
CREATE TRIGGER trg_route_sheet_reply_deletion BEFORE INSERT ON public.sheet_reply_deletions
FOR EACH ROW EXECUTE FUNCTION public.route_sheet_reply_deletion();

-- Serialize incoming imports against the mode switch. Outbound acknowledgments have no changed content.
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
   IF cfg->>'mode'='app_only' THEN RAISE EXCEPTION 'Sheet import disabled by app-only input setting'; END IF;
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
 IF cfg->>'mode'='app_only' THEN RAISE EXCEPTION 'Sheet import disabled by app-only input setting'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_app_only_sheet_import ON public.practice_records;
CREATE TRIGGER trg_guard_app_only_sheet_import BEFORE INSERT OR UPDATE ON public.practice_records
FOR EACH ROW EXECUTE FUNCTION public.guard_app_only_sheet_import();
DROP TRIGGER IF EXISTS trg_guard_app_only_sheet_import ON public.sheet_record_replies;
CREATE TRIGGER trg_guard_app_only_sheet_import BEFORE INSERT OR UPDATE OR DELETE ON public.sheet_record_replies
FOR EACH ROW EXECUTE FUNCTION public.guard_app_only_sheet_import();

-- A record entered during the overlap uses its own period's form schema.
CREATE OR REPLACE FUNCTION public.set_practice_record_field_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.is_mirror_write() THEN RETURN NEW; END IF;
 IF NEW.record_fields_snapshot IS NULL OR NEW.record_fields_version IS NULL THEN
   SELECT CASE WHEN NEW.recorded_date < DATE '2026-10-01' AND sheet_transition->>'version'='2026-10'
     THEN sheet_transition->'legacy'->'record_fields' ELSE record_fields END,
     CASE WHEN NEW.recorded_date < DATE '2026-10-01' AND sheet_transition->>'version'='2026-10'
     THEN coalesce((sheet_transition->'legacy'->>'record_fields_version')::integer,record_fields_version)
     ELSE record_fields_version END
   INTO NEW.record_fields_snapshot,NEW.record_fields_version FROM public.profiles WHERE id=NEW.user_id;
 END IF;
 RETURN NEW;
END;
$$;

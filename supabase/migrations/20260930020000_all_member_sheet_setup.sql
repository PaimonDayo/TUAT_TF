-- Self-service rollout. Existing profiles/notices failover logging and mirror cover these changes. No new tables.
CREATE OR REPLACE FUNCTION public.save_october_sheet_setup(p_sheet_name text, p_fields jsonb, p_signature text, p_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prior public.profiles; legacy jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
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

CREATE OR REPLACE FUNCTION public.route_sheet_reply_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg jsonb;
BEGIN
 IF public.is_mirror_write() THEN RETURN NEW; END IF;
 SELECT p.sheet_transition INTO cfg FROM public.practice_records r JOIN public.profiles p ON p.id=r.user_id WHERE r.id=NEW.record_id;
 IF NEW.recorded_date < DATE '2026-10-01' THEN
   NEW.legacy_period:=true;
   NEW.sheet_name:=coalesce(cfg->'legacy'->>'sheet_name',NEW.sheet_name);
 ELSIF cfg->>'version'='2026-10' THEN
   NEW.spreadsheet_id:='18HKZrVL-JtXbZ9zcYUFPRPGIGCpd7ltLOsmvBKdJfR8';
 END IF;
 RETURN NEW;
END;
$$;

-- Publish only the existing setup guide. No new notification or profile changes.
UPDATE public.notices SET system_only=false
WHERE id='30260930-0000-4000-8000-000000000001' AND system_only=true;

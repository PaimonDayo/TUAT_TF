-- All absent, withdrawn and orphaned appearances are DNS, regardless of saved trials.
CREATE OR REPLACE FUNCTION public._ob_unified_dns(p_event text,p_data jsonb) RETURNS jsonb
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_set(p_data,'{participants}',coalesce((SELECT jsonb_agg(
  CASE WHEN p->>'status'='DNS' OR e.id IS NULL OR e.absent OR NOT public._ob_appearance_registered(e.events,p_event,p->>'entryId')
   THEN (p-'heatScope')||jsonb_build_object('status','DNS','group',NULL,'order',NULL) ELSE p END ORDER BY n)
  FROM jsonb_array_elements(p_data->'participants') WITH ORDINALITY rows(p,n)
  LEFT JOIN public.ob_meet_entries e ON e.meet_key='ob-2026' AND e.id::text=split_part(p->>'entryId',':',1)),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public._ob_unified_dns(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.release_ob_dns_positions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Mirror writes copy the canonical source snapshot without new local side effects.
 IF NOT public.is_mirror_write() AND NEW.meet_key='ob-2026' THEN NEW.data:=public._ob_unified_dns(NEW.event_name,NEW.data); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_ob_dns_positions() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.release_ob_entry_positions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry_id uuid; op public.ob_event_operations%ROWTYPE; next_data jsonb;
BEGIN
 IF public.is_mirror_write() THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN entry_id:=OLD.id; ELSE entry_id:=NEW.id; END IF;
 IF TG_OP='UPDATE' AND NEW.events IS NOT DISTINCT FROM OLD.events AND NEW.absent IS NOT DISTINCT FROM OLD.absent THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 FOR op IN SELECT * FROM public.ob_event_operations o WHERE o.meet_key='ob-2026'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.data->'participants') p WHERE split_part(p->>'entryId',':',1)=entry_id::text)
  ORDER BY event_name FOR UPDATE LOOP
  next_data:=public._ob_unified_dns(op.event_name,op.data);
  IF next_data IS DISTINCT FROM op.data THEN
   UPDATE public.ob_event_operations SET data=next_data,revision=revision+1,updated_at=now() WHERE meet_key=op.meet_key AND event_name=op.event_name;
   INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES(op.meet_key,op.event_name,auth.uid(),op.data,next_data);
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.release_ob_entry_positions() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ob_release_entry_positions ON public.ob_meet_entries;
CREATE TRIGGER ob_release_entry_positions AFTER INSERT OR UPDATE OF events,absent OR DELETE ON public.ob_meet_entries
 FOR EACH ROW EXECUTE FUNCTION public.release_ob_entry_positions();

CREATE OR REPLACE FUNCTION public._save_ob_event_operation_mixed(p_event text,p_revision integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  target public.ob_event_operations%ROWTYPE; saved public.ob_event_operations%ROWTYPE;
  p jsonb; t jsonb; entry public.ob_meet_entries%ROWTYPE;
  ids text[]:='{}'; places text[]:='{}'; position_key text; base text;
  track boolean; height boolean; wind_allowed boolean; confirmed boolean;
  mark text; wind text; state text; parts text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_record_ob_meet() THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
  IF p_event IS NULL OR p_event !~ '^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$'
    OR p_revision<0 OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>250000
    OR jsonb_typeof(p_data->'participants') IS DISTINCT FROM 'array' OR jsonb_typeof(p_data->'confirmed') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  IF jsonb_array_length(p_data->'participants')>300 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('participants','confirmed')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
  -- Serialize initial inserts as well as updates; the expected revision prevents lost updates.
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||p_event,0));
  p_data:=public._ob_unified_dns(p_event,p_data);
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
  -- DNS automatically releases its position; other placement changes still require management.
  IF NOT (public.can_manage_system() OR public.can_manage_ob_meet()) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_data->'participants') person
    LEFT JOIN LATERAL (SELECT old FROM jsonb_array_elements(coalesce(target.data->'participants','[]'::jsonb)) old
      WHERE old->>'entryId'=person->>'entryId') previous ON true
    WHERE person->>'status'<>'DNS' AND (coalesce(person->'group','null'::jsonb) IS DISTINCT FROM coalesce(previous.old->'group','null'::jsonb)
       OR coalesce(person->'order','null'::jsonb) IS DISTINCT FROM coalesce(previous.old->'order','null'::jsonb)
       OR coalesce(person->>'heatScope',left(p_event,2)) IS DISTINCT FROM coalesce(previous.old->>'heatScope',left(p_event,2)))
  ) THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
  IF (FOUND AND p_revision IS DISTINCT FROM target.revision) OR (NOT FOUND AND p_revision IS NOT NULL) THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  base:=substring(p_event FROM 3); track:=base IN ('100m','300m','300mH','1500m','3000m'); height:=base='走り高跳び'; wind_allowed:=base IN ('100m','走り幅跳び'); confirmed:=(p_data->>'confirmed')::boolean;
  -- Lock registrations consulted below so entry edits cannot race validation.
  PERFORM 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' ORDER BY id FOR SHARE;
  FOR p IN SELECT value FROM jsonb_array_elements(p_data->'participants') LOOP
    IF jsonb_typeof(p)<>'object' OR jsonb_typeof(p->'entryId') IS DISTINCT FROM 'string'
      OR (p->>'entryId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:2)?$'
      OR p->>'entryId'<>lower(p->>'entryId') OR p->>'entryId'=ANY(ids) OR p->>'status' IS NULL OR p->>'status' NOT IN ('entered','DNS','DNF','DQ')
      OR jsonb_typeof(p->'trials') IS DISTINCT FROM 'array'
      OR (p ? 'heatScope' AND (jsonb_typeof(p->'heatScope') IS DISTINCT FROM 'string' OR p->>'heatScope' NOT IN ('男子','女子','混合')))
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('entryId','group','order','status','trials','heatScope')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    ids:=array_append(ids,p->>'entryId');
    SELECT * INTO entry FROM public.ob_meet_entries WHERE id=public._ob_appearance_entry_id(p->>'entryId') AND meet_key='ob-2026';
    IF NOT FOUND THEN
     IF p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId') THEN RAISE EXCEPTION 'operation_roster'; END IF;
    ELSIF NOT public._ob_appearance_registered(entry.events,p_event,p->>'entryId') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId') THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT public._ob_appearance_registered(entry.events,p_event,p->>'entryId') AND p->>'status'='entered'
      AND p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')
      THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT (p ? 'group' AND p ? 'order') OR EXISTS(SELECT 1 FROM (VALUES(p->'group',99),(p->'order',600)) v(n,maximum) WHERE n<>'null'::jsonb AND (jsonb_typeof(n)<>'number' OR (n#>>'{}') !~ '^[1-9][0-9]{0,2}$' OR (n#>>'{}')::numeric>maximum)) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    -- Absence preserves history, but cannot be used to resume or change a recorded run.
    IF entry.absent AND p->'trials' IS DISTINCT FROM coalesce((SELECT old->'trials' FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId'),'[]'::jsonb)
      THEN RAISE EXCEPTION 'operation_absent'; END IF;
    IF entry.absent AND p->>'status'='entered' AND p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')
      AND p IS DISTINCT FROM jsonb_build_object('entryId',p->>'entryId','group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb) THEN RAISE EXCEPTION 'operation_absent'; END IF;
    IF p->>'group' IS NOT NULL AND p->>'order' IS NOT NULL AND p->>'status'<>'DNS' THEN
      position_key:=coalesce(p->>'heatScope',left(p_event,2))||':'||(p->>'group')||':'||(p->>'order');
      IF position_key=ANY(places) THEN RAISE EXCEPTION 'operation_position'; END IF;
      places:=array_append(places,position_key);
    END IF;
    IF jsonb_array_length(p->'trials')>(CASE WHEN track THEN 1 WHEN height THEN 30 ELSE 6 END) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    FOR t IN SELECT value FROM jsonb_array_elements(p->'trials') LOOP
      IF jsonb_typeof(t)<>'object' OR jsonb_typeof(t->'mark') IS DISTINCT FROM 'string' OR jsonb_typeof(t->'wind') IS DISTINCT FROM 'string'
        OR t->>'status' IS NULL OR t->>'status' NOT IN ('pending','valid','foul','pass')
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(t) k WHERE k NOT IN ('mark','wind','status')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
      mark:=t->>'mark'; wind:=t->>'wind'; state:=t->>'status';
      IF track AND state NOT IN ('pending','valid') THEN RAISE EXCEPTION 'operation_mark'; END IF;
      IF length(mark)>20 OR length(wind)>8 OR (state='pending' AND (mark<>'' OR wind<>''))
        OR (state='valid' AND mark='') OR (height AND state<>'pending' AND mark='')
        OR (NOT height AND state NOT IN ('pending','valid') AND mark<>'') THEN RAISE EXCEPTION 'operation_mark'; END IF;
      IF mark<>'' THEN
        IF track THEN
          IF mark !~ '^[0-9]{1,3}(:[0-9]{1,2}){0,2}(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'operation_mark'; END IF;
          parts:=string_to_array(mark,':');
          IF EXISTS(SELECT 1 FROM unnest(parts) WITH ORDINALITY a(n,i) WHERE i>1 AND n::numeric>=60) OR NOT EXISTS(SELECT 1 FROM unnest(parts) a(n) WHERE n::numeric>0) THEN RAISE EXCEPTION 'operation_mark'; END IF;
        ELSIF mark !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' OR mark::numeric<=0 THEN RAISE EXCEPTION 'operation_mark';
        END IF;
      END IF;
      IF wind<>'' AND (state<>'valid' OR NOT wind_allowed OR wind !~ '^[+-]?[0-9]{1,2}(\.[0-9])?$') THEN RAISE EXCEPTION 'operation_wind'; END IF;
    END LOOP;
    IF confirmed AND NOT entry.absent AND public._ob_appearance_registered(entry.events,p_event,p->>'entryId') AND p->>'status'='entered' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'trials') a WHERE a->>'status' IN ('valid','foul')) THEN RAISE EXCEPTION 'operation_incomplete'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.ob_meet_entries e CROSS JOIN LATERAL generate_series(1,(SELECT count(*)::integer FROM unnest(e.events) event WHERE event=p_event)) n WHERE meet_key='ob-2026' AND NOT (e.id::text||CASE WHEN n=2 THEN ':2' ELSE '' END)=ANY(ids))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE NOT (old->>'entryId')=ANY(ids)) THEN RAISE EXCEPTION 'operation_roster'; END IF;
  IF target.event_name IS NOT NULL AND p_data IS NOT DISTINCT FROM target.data THEN RETURN to_jsonb(target); END IF;
  INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data,updated_at) VALUES('ob-2026',p_event,coalesce(target.revision+1,0),p_data,now())
    ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at RETURNING * INTO saved;
  INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES('ob-2026',p_event,auth.uid(),target.data,p_data);
  RETURN to_jsonb(saved);
END $$;

CREATE OR REPLACE FUNCTION public.apply_ob_sheet_statuses(p_request_id uuid,p_changes jsonb,p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 item jsonb; e public.ob_meet_entries%ROWTYPE; op public.ob_event_operations%ROWTYPE;
 prior public.ob_operation_changes%ROWTYPE; person jsonb; persons jsonb; next_data jsonb;
 event text; family text; result jsonb; first_event text; first_before jsonb; first_after jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'sheet_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_dry_run IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 600 OR pg_column_size(p_changes)>500000
  THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
 -- Same lock/order as all app registration and operation edits.
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT * INTO prior FROM public.ob_operation_changes WHERE request_id=p_request_id;
 IF FOUND THEN
  IF prior.actor_id IS NOT NULL OR prior.request_payload IS DISTINCT FROM p_changes THEN RAISE EXCEPTION 'sheet_request'; END IF;
  RETURN prior.request_result;
 END IF;
 IF (SELECT count(DISTINCT (value->>'entryId',value->>'event')) FROM jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes) THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
 -- Validate EVERY row before changing any row. The source revisions are signed by the API.
 FOR item IN SELECT value FROM jsonb_array_elements(p_changes) ORDER BY value->>'event',value->>'entryId' LOOP
  event:=item->>'event';
  IF event IS NULL OR event !~ '^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$'
   OR item->>'status' IS NULL OR item->>'status' NOT IN ('entered','DNS','DNF','DQ')
   OR NOT (item ?& ARRAY['entryId','event','entryRevision','operationRevision','status'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('entryId','event','entryRevision','operationRevision','status'))
   THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
  SELECT * INTO e FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND id=public._ob_appearance_entry_id(item->>'entryId') FOR UPDATE;
  IF NOT FOUND OR e.revision IS DISTINCT FROM (item->>'entryRevision')::integer OR NOT public._ob_appearance_registered(e.events,event,item->>'entryId')
   THEN RAISE EXCEPTION 'sheet_entry_conflict' USING ERRCODE='40001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||event,0));
  SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event FOR UPDATE;
  IF op.revision IS DISTINCT FROM (item->>'operationRevision')::integer THEN RAISE EXCEPTION 'sheet_operation_conflict' USING ERRCODE='40001'; END IF;
 END LOOP;
 result:=jsonb_build_object('requestId',p_request_id,'count',jsonb_array_length(p_changes),'dryRun',p_dry_run);
 IF p_dry_run THEN RETURN result; END IF;
 FOR event IN SELECT DISTINCT value->>'event' FROM jsonb_array_elements(p_changes) ORDER BY 1 LOOP
  SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
  persons:=coalesce(op.data->'participants','[]'::jsonb);
  FOR item IN SELECT value FROM jsonb_array_elements(p_changes) WHERE value->>'event'=event LOOP
   SELECT value INTO person FROM jsonb_array_elements(persons) WHERE value->>'entryId'=item->>'entryId';
   IF person IS NULL THEN person:=jsonb_build_object('entryId',item->>'entryId','group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb); END IF;
   -- Keep placements and every trial, changing only this event's declaration.
   person:=jsonb_set(person,'{status}',item->'status');
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(persons) p WHERE p->>'entryId'=item->>'entryId') THEN
    SELECT coalesce(jsonb_agg(CASE WHEN value->>'entryId'=item->>'entryId' THEN person ELSE value END ORDER BY n),'[]') INTO persons
     FROM jsonb_array_elements(persons) WITH ORDINALITY p(value,n);
   ELSE persons:=persons||jsonb_build_array(person); END IF;
   -- Choosing an actual start/result also cancels the person's meet-wide absence.
   IF item->>'status'<>'DNS' THEN
    UPDATE public.ob_meet_entries SET absent=false,revision=revision+1 WHERE id=public._ob_appearance_entry_id(item->>'entryId') AND meet_key='ob-2026' AND absent;
   END IF;
  END LOOP;
  next_data:=public._ob_unified_dns(event,jsonb_build_object('participants',persons,'confirmed',false));
  INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data) VALUES('ob-2026',event,coalesce(op.revision,-1)+1,next_data)
   ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=now();
  IF first_event IS NULL THEN first_event:=event; first_before:=op.data; first_after:=next_data;
  ELSE INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES('ob-2026',event,NULL,op.data,next_data); END IF;
 END LOOP;
 -- Resuming DNS must obey the same mixed-lane/order constraints as app edits.
 FOR family IN SELECT DISTINCT substring(value->>'event' FROM 3) FROM jsonb_array_elements(p_changes) LOOP
  PERFORM public._validate_ob_family_positions(family);
 END LOOP;
 INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data,request_id,request_payload,request_result)
  VALUES('ob-2026',first_event,NULL,first_before,first_after,p_request_id,p_changes,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.apply_ob_sheet_edits(p_request_id uuid,p_context jsonb,p_changes jsonb,p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; e public.ob_meet_entries%ROWTYPE; op public.ob_event_operations%ROWTYPE;
 prior public.ob_operation_changes%ROWTYPE; request jsonb; result jsonb; name_key text;
 event text; family text; entry_uuid uuid; person jsonb; persons jsonb; next_data jsonb;
 first_event text; first_before jsonb; first_after jsonb; proposed_group integer; proposed_order integer; scope text; appearance_id text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'sheet_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_dry_run IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 600 OR pg_column_size(p_changes)>500000
  OR jsonb_typeof(p_context->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(p_context->'operations') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
 request:=jsonb_build_object('version',1,'context',p_context,'changes',p_changes);
 -- Name locks precede the roster lock, matching app guest registration.
 FOR name_key IN SELECT DISTINCT value->>'newKey' FROM jsonb_array_elements(p_changes) WHERE value->>'entryId' IS NULL ORDER BY 1 LOOP
  IF name_key IS NULL OR name_key='' THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/name/'||name_key,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT * INTO prior FROM public.ob_operation_changes WHERE request_id=p_request_id;
 IF FOUND THEN
  IF prior.actor_id IS NOT NULL OR prior.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'sheet_request'; END IF;
  RETURN prior.request_result;
 END IF;
 -- Signed roster revisions prevent additions from racing app registration/cancellation.
 IF (SELECT count(*) FROM public.ob_meet_entries WHERE meet_key='ob-2026')<>(SELECT count(DISTINCT public._ob_appearance_entry_id(c->>'id')) FROM jsonb_array_elements(p_context->'entries') c)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_context->'entries') c LEFT JOIN public.ob_meet_entries roster ON roster.id=public._ob_appearance_entry_id(c->>'id') AND roster.meet_key='ob-2026'
    WHERE roster.id IS NULL OR roster.revision IS DISTINCT FROM (c->>'revision')::integer)
 THEN RAISE EXCEPTION 'sheet_roster_conflict' USING ERRCODE='40001'; END IF;
 IF (SELECT count(DISTINCT (coalesce(value->>'entryId',value->>'newKey'),value->>'event')) FROM jsonb_array_elements(p_changes))<>jsonb_array_length(p_changes) THEN RAISE EXCEPTION 'sheet_duplicate'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_changes) ORDER BY value->>'event' LOOP
  event:=item->>'event';
  IF event IS NULL OR event !~ '^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$'
   OR item->>'status' IS NULL OR item->>'status' NOT IN ('entered','DNS','DNF','DQ')
   OR jsonb_typeof(item->'position') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||event,0));
  SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event FOR UPDATE;
  IF op.revision IS DISTINCT FROM (item->>'operationRevision')::integer THEN RAISE EXCEPTION 'sheet_operation_conflict' USING ERRCODE='40001'; END IF;
  IF item->>'entryId' IS NOT NULL THEN
   SELECT * INTO e FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND id=public._ob_appearance_entry_id(item->>'entryId') FOR UPDATE;
   IF NOT FOUND OR e.revision IS DISTINCT FROM (item->>'entryRevision')::integer THEN RAISE EXCEPTION 'sheet_entry_conflict' USING ERRCODE='40001'; END IF;
   IF e.competition_division IS DISTINCT FROM left(event,2) THEN RAISE EXCEPTION 'sheet_division'; END IF;
  ELSE
   name_key:=regexp_replace(normalize(item->>'name',NFKC),'[[:space:]　]','','g');
   IF item->>'name' IS NULL OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 100 OR name_key='' OR name_key IS DISTINCT FROM item->>'newKey'
    OR item->>'grade' IS NULL OR item->>'grade' NOT IN ('B1','B2','B3','B4','M1','M2','D1','D2','D3','OB・OG') THEN RAISE EXCEPTION 'sheet_invalid'; END IF;
   IF EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND regexp_replace(normalize(submitted_name,NFKC),'[[:space:]　]','','g')=name_key) THEN RAISE EXCEPTION 'sheet_duplicate' USING ERRCODE='23505'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) c WHERE c->>'newKey'=name_key AND (c->>'grade' IS DISTINCT FROM item->>'grade' OR left(c->>'event',2)<>left(event,2))) THEN RAISE EXCEPTION 'sheet_identity'; END IF;
  END IF;
  IF (item->>'position')::boolean THEN
   IF NOT (item ?& ARRAY['group','order','heatScope']) OR item->>'heatScope' NOT IN ('男子','女子','混合')
    OR EXISTS(SELECT 1 FROM (VALUES(item->'group',99),(item->'order',600)) v(n,maximum) WHERE n<>'null'::jsonb AND (jsonb_typeof(n)<>'number' OR (n#>>'{}') !~ '^[1-9][0-9]{0,2}$' OR (n#>>'{}')::numeric>maximum)) THEN RAISE EXCEPTION 'sheet_position'; END IF;
  END IF;
 END LOOP;
 result:=jsonb_build_object('requestId',p_request_id,'count',jsonb_array_length(p_changes),'dryRun',p_dry_run);
 -- Execute the exact proposed transaction for dryRun, then roll back this subtransaction.
 BEGIN
  FOR name_key IN SELECT DISTINCT value->>'newKey' FROM jsonb_array_elements(p_changes) WHERE value->>'entryId' IS NULL LOOP
   SELECT value INTO item FROM jsonb_array_elements(p_changes) WHERE value->>'newKey'=name_key LIMIT 1;
   entry_uuid:=md5(p_request_id::text||':'||name_key)::uuid;
   INSERT INTO public.ob_meet_entries(id,meet_key,submitted_name,grade,events,competition_division)
    VALUES(entry_uuid,'ob-2026',btrim(item->>'name'),item->>'grade','{}',left(item->>'event',2));
  END LOOP;
  FOR event IN SELECT DISTINCT value->>'event' FROM jsonb_array_elements(p_changes) ORDER BY 1 LOOP
   SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
   persons:=coalesce(op.data->'participants','[]'::jsonb);
   FOR item IN SELECT value FROM jsonb_array_elements(p_changes) WHERE value->>'event'=event LOOP
    entry_uuid:=coalesce(public._ob_appearance_entry_id(item->>'entryId'),md5(p_request_id::text||':'||(item->>'newKey'))::uuid);
    SELECT * INTO e FROM public.ob_meet_entries WHERE id=entry_uuid;
    appearance_id:=coalesce(item->>'entryId',entry_uuid::text);
    IF NOT public._ob_appearance_registered(e.events,event,appearance_id) THEN
     IF right(appearance_id,2)=':2' AND NOT event=ANY(e.events) THEN RAISE EXCEPTION 'sheet_entry_conflict'; END IF;
     IF coalesce((op.data->>'confirmed')::boolean,false) THEN RAISE EXCEPTION 'sheet_event_confirmed'; END IF;
     -- A new event must not silently bypass an existing helper assignment.
     IF EXISTS(SELECT 1 FROM (SELECT profile_id,NULL::uuid entry_id,slot_time,assignment,role_ids FROM public.ob_meet_duties WHERE meet_key='ob-2026'
       UNION ALL SELECT NULL::uuid,entry_id,slot_time,assignment,role_ids FROM public.ob_entry_duties WHERE meet_key='ob-2026') d
       JOIN public.ob_duty_event_slots s ON s.slot_time=d.slot_time AND s.event_name=CASE substring(event FROM 3) WHEN '立ち五段' THEN '立ち五段跳び' ELSE substring(event FROM 3) END
       WHERE (d.entry_id=e.id OR d.profile_id=e.profile_id) AND (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'')) THEN RAISE EXCEPTION 'sheet_duty_conflict'; END IF;
     UPDATE public.ob_meet_entries SET events=array_append(events,event),revision=revision+1 WHERE id=entry_uuid;
    END IF;
    SELECT value INTO person FROM jsonb_array_elements(persons) WHERE value->>'entryId'=appearance_id;
    IF person IS NULL THEN person:=jsonb_build_object('entryId',appearance_id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb); END IF;
    IF (item->>'position')::boolean THEN
     proposed_group:=(item->>'group')::integer; proposed_order:=(item->>'order')::integer; scope:=item->>'heatScope';
     IF proposed_group IS DISTINCT FROM (person->>'group')::integer OR proposed_order IS DISTINCT FROM (person->>'order')::integer OR scope IS DISTINCT FROM coalesce(person->>'heatScope',left(event,2)) THEN
      IF coalesce((op.data->>'confirmed')::boolean,false) THEN RAISE EXCEPTION 'sheet_started'; END IF;
      person:=(person-'heatScope')||jsonb_build_object('group',proposed_group,'order',proposed_order,'heatScope',scope);
     END IF;
    END IF;
    person:=jsonb_set(person,'{status}',item->'status');
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(persons) p WHERE p->>'entryId'=appearance_id) THEN
     SELECT coalesce(jsonb_agg(CASE WHEN value->>'entryId'=appearance_id THEN person ELSE value END ORDER BY n),'[]') INTO persons FROM jsonb_array_elements(persons) WITH ORDINALITY p(value,n);
    ELSE persons:=persons||jsonb_build_array(person); END IF;
    IF item->>'status'<>'DNS' THEN UPDATE public.ob_meet_entries SET absent=false,revision=revision+1 WHERE id=entry_uuid AND absent; END IF;
   END LOOP;
   IF jsonb_array_length(persons)>600 THEN RAISE EXCEPTION 'sheet_capacity'; END IF;
   next_data:=public._ob_unified_dns(event,jsonb_build_object('participants',persons,'confirmed',false));
   INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data) VALUES('ob-2026',event,coalesce(op.revision,-1)+1,next_data)
    ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=now();
   IF first_event IS NULL THEN first_event:=event; first_before:=op.data; first_after:=next_data;
   ELSE INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES('ob-2026',event,NULL,op.data,next_data); END IF;
  END LOOP;
  FOR family IN SELECT DISTINCT substring(value->>'event' FROM 3) FROM jsonb_array_elements(p_changes) LOOP PERFORM public._validate_ob_family_positions(family); END LOOP;
  IF p_dry_run THEN RAISE SQLSTATE 'P0DRY'; END IF;
  INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data,request_id,request_payload,request_result)
   VALUES('ob-2026',first_event,NULL,first_before,first_after,p_request_id,request,result);
 EXCEPTION WHEN SQLSTATE 'P0DRY' THEN RETURN result;
 END;
 RETURN result;
END $$;

-- Re-running the migration leaves already released rows and their histories unchanged.
DO $release$
DECLARE op public.ob_event_operations%ROWTYPE; next_data jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 FOR op IN SELECT * FROM public.ob_event_operations WHERE meet_key='ob-2026' ORDER BY event_name FOR UPDATE LOOP
  next_data:=public._ob_unified_dns(op.event_name,op.data);
  IF next_data IS DISTINCT FROM op.data THEN
   UPDATE public.ob_event_operations SET data=next_data,revision=revision+1,updated_at=now()
    WHERE meet_key=op.meet_key AND event_name=op.event_name;
   INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data)
    VALUES(op.meet_key,op.event_name,NULL,op.data,next_data);
  END IF;
 END LOOP;
END $release$;

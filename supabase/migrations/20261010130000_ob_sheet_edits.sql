-- Fixed OB2026 publisher: atomic additions/positions/status, no contact/profile/party reads.
CREATE OR REPLACE FUNCTION public.apply_ob_sheet_edits(p_request_id uuid,p_context jsonb,p_changes jsonb,p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; e public.ob_meet_entries%ROWTYPE; op public.ob_event_operations%ROWTYPE;
 prior public.ob_operation_changes%ROWTYPE; request jsonb; result jsonb; name_key text;
 event text; family text; entry_uuid uuid; person jsonb; persons jsonb; next_data jsonb;
 first_event text; first_before jsonb; first_after jsonb; proposed_group integer; proposed_order integer; scope text;
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
 IF (SELECT count(*) FROM public.ob_meet_entries WHERE meet_key='ob-2026')<>jsonb_array_length(p_context->'entries')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_context->'entries') c LEFT JOIN public.ob_meet_entries roster ON roster.id=(c->>'id')::uuid AND roster.meet_key='ob-2026'
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
   SELECT * INTO e FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND id=(item->>'entryId')::uuid FOR UPDATE;
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
    entry_uuid:=coalesce((item->>'entryId')::uuid,md5(p_request_id::text||':'||(item->>'newKey'))::uuid);
    SELECT * INTO e FROM public.ob_meet_entries WHERE id=entry_uuid;
    IF NOT event=ANY(e.events) THEN
     IF coalesce((op.data->>'confirmed')::boolean,false) THEN RAISE EXCEPTION 'sheet_event_confirmed'; END IF;
     -- A new event must not silently bypass an existing helper assignment.
     IF EXISTS(SELECT 1 FROM (SELECT profile_id,NULL::uuid entry_id,slot_time,assignment,role_ids FROM public.ob_meet_duties WHERE meet_key='ob-2026'
       UNION ALL SELECT NULL::uuid,entry_id,slot_time,assignment,role_ids FROM public.ob_entry_duties WHERE meet_key='ob-2026') d
       JOIN public.ob_duty_event_slots s ON s.slot_time=d.slot_time AND s.event_name=CASE substring(event FROM 3) WHEN '立ち五段' THEN '立ち五段跳び' ELSE substring(event FROM 3) END
       WHERE (d.entry_id=e.id OR d.profile_id=e.profile_id) AND (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'')) THEN RAISE EXCEPTION 'sheet_duty_conflict'; END IF;
     UPDATE public.ob_meet_entries SET events=array_append(events,event),revision=revision+1 WHERE id=entry_uuid;
    END IF;
    SELECT value INTO person FROM jsonb_array_elements(persons) WHERE value->>'entryId'=entry_uuid::text;
    IF person IS NULL THEN person:=jsonb_build_object('entryId',entry_uuid,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb); END IF;
    IF (item->>'position')::boolean THEN
     proposed_group:=(item->>'group')::integer; proposed_order:=(item->>'order')::integer; scope:=item->>'heatScope';
     IF proposed_group IS DISTINCT FROM (person->>'group')::integer OR proposed_order IS DISTINCT FROM (person->>'order')::integer OR scope IS DISTINCT FROM coalesce(person->>'heatScope',left(event,2)) THEN
      IF coalesce((op.data->>'confirmed')::boolean,false) OR person->>'status' IN ('DNF','DQ') OR EXISTS(SELECT 1 FROM jsonb_array_elements(person->'trials') t WHERE t->>'status'<>'pending' OR t->>'mark'<>'' OR t->>'wind'<>'') THEN RAISE EXCEPTION 'sheet_started'; END IF;
      person:=(person-'heatScope')||jsonb_build_object('group',proposed_group,'order',proposed_order,'heatScope',scope);
     END IF;
    END IF;
    person:=jsonb_set(person,'{status}',item->'status');
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(persons) p WHERE p->>'entryId'=entry_uuid::text) THEN
     SELECT coalesce(jsonb_agg(CASE WHEN value->>'entryId'=entry_uuid::text THEN person ELSE value END ORDER BY n),'[]') INTO persons FROM jsonb_array_elements(persons) WITH ORDINALITY p(value,n);
    ELSE persons:=persons||jsonb_build_array(person); END IF;
    IF item->>'status'<>'DNS' THEN UPDATE public.ob_meet_entries SET absent=false,revision=revision+1 WHERE id=entry_uuid AND absent; END IF;
   END LOOP;
   IF jsonb_array_length(persons)>600 THEN RAISE EXCEPTION 'sheet_capacity'; END IF;
   next_data:=jsonb_build_object('participants',persons,'confirmed',false);
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
REVOKE ALL ON FUNCTION public.apply_ob_sheet_edits(uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ob_sheet_edits(uuid,jsonb,jsonb,boolean) TO service_role;
COMMENT ON FUNCTION public.apply_ob_sheet_edits(uuid,jsonb,jsonb,boolean) IS 'migration 20261010130000: private OB2026 entry/position/status sync';
NOTIFY pgrst,'reload schema';

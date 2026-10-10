-- Private publisher edits statuses only; existing registration/results/audit tables stay intact.
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
  SELECT * INTO e FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND id=(item->>'entryId')::uuid FOR UPDATE;
  IF NOT FOUND OR e.revision IS DISTINCT FROM (item->>'entryRevision')::integer OR NOT event=ANY(e.events)
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
    UPDATE public.ob_meet_entries SET absent=false,revision=revision+1 WHERE id=(item->>'entryId')::uuid AND meet_key='ob-2026' AND absent;
   END IF;
  END LOOP;
  next_data:=jsonb_build_object('participants',persons,'confirmed',false);
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
REVOKE ALL ON FUNCTION public.apply_ob_sheet_statuses(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ob_sheet_statuses(uuid,jsonb,boolean) TO service_role;
NOTIFY pgrst,'reload schema';

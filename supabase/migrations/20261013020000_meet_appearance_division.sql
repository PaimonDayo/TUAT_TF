-- Keep the existing mutation implementation and route division corrections through
-- the same public RPC, immutable request ledger, and OB operator guard.
DO $$ BEGIN
 IF to_regprocedure('public.mutate_competition_meet_base(text,uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.mutate_competition_meet(text,uuid,jsonb) RENAME TO mutate_competition_meet_base;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.mutate_competition_meet_base(text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.mutate_competition_meet(p_competition_id text,p_request_id uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 rights jsonb; previous public.competition_meet_requests%ROWTYPE;
 appearance public.competition_appearances%ROWTYPE; person public.competition_participants%ROWTYPE;
 source_event public.competition_meet_events%ROWTYPE; target_event public.competition_meet_events%ROWTYPE;
 next_ordinal integer; next_operation_key text; result jsonb; after_value jsonb;
BEGIN
 IF p_command->>'action' IS DISTINCT FROM 'appearance.moveDivision' THEN
  RETURN public.mutate_competition_meet_base(p_competition_id,p_request_id,p_command);
 END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved)
  OR p_request_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR pg_column_size(p_command)>250000
 THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 IF p_command->>'backend' IS NOT NULL AND p_command->>'backend' IS DISTINCT FROM
  (CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END)
 THEN RAISE EXCEPTION 'meet_backend_changed'; END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||p_competition_id::text,0));
 SELECT * INTO previous FROM public.competition_meet_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM auth.uid() OR previous.competition_id<>p_competition_id OR previous.command IS DISTINCT FROM p_command
  THEN RAISE EXCEPTION 'meet_request'; END IF;
  RETURN previous.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=p_competition_id AND ready)
 THEN RAISE EXCEPTION 'meet_invalid'; END IF;
 IF jsonb_typeof(p_command->'event') IS DISTINCT FROM 'string' OR length(btrim(p_command->>'event')) NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'meet_invalid'; END IF;
 IF p_command->>'mark' IS NOT NULL AND (jsonb_typeof(p_command->'mark') IS DISTINCT FROM 'string' OR length(p_command->>'mark')>1000)
 THEN RAISE EXCEPTION 'meet_invalid'; END IF;

 SELECT * INTO appearance FROM public.competition_appearances
 WHERE id=(p_command->>'id')::uuid AND competition_id=p_competition_id FOR UPDATE;
 IF NOT FOUND OR appearance.revision IS DISTINCT FROM (p_command->>'revision')::integer
 THEN RAISE EXCEPTION 'meet_conflict'; END IF;
 SELECT * INTO person FROM public.competition_participants WHERE id=appearance.participant_id;
 rights:=public.competition_meet_permissions(p_competition_id);
 IF NOT coalesce((rights->>'manage')::boolean,false)
  AND (NOT coalesce((rights->>'register')::boolean,false) OR person.profile_id IS DISTINCT FROM auth.uid())
 THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;

 SELECT * INTO source_event FROM public.competition_meet_events
 WHERE competition_id=p_competition_id AND name=appearance.event_name FOR UPDATE;
 SELECT * INTO target_event FROM public.competition_meet_events
 WHERE competition_id=p_competition_id AND name=p_command->>'event' FOR UPDATE;
 IF NOT FOUND OR source_event.name=target_event.name
  OR source_event.division NOT IN ('男子','女子') OR target_event.division NOT IN ('男子','女子')
  OR source_event.division=target_event.division OR source_event.family IS DISTINCT FROM target_event.family
  OR source_event.discipline IS DISTINCT FROM target_event.discipline OR source_event.wind IS DISTINCT FROM target_event.wind
  OR source_event.capacity IS DISTINCT FROM target_event.capacity
 THEN RAISE EXCEPTION 'meet_division'; END IF;
 IF source_event.confirmed OR target_event.confirmed THEN RAISE EXCEPTION 'meet_confirmed'; END IF;
 -- Correcting the category preserves attendance and saved outcomes. If its time
 -- changes, retain duties and require acknowledgement of an effective conflict.
 IF source_event.starts_at IS DISTINCT FROM target_event.starts_at
  AND ((appearance.state='registered' AND appearance.performance->>'status'<>'DNS')
   OR appearance.performance->>'status' IN ('DNF','DQ')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(appearance.performance->'trials') trial
    WHERE trial->>'status'<>'pending' OR trial->>'mark'<>'' OR trial->>'wind'<>''))
  AND EXISTS(SELECT 1 FROM public.competition_meet_duties WHERE participant_id=person.id
   AND slot_time=target_event.starts_at AND (assignment<>'' OR cardinality(role_ids)>0))
  AND NOT coalesce((p_command->>'confirmDuties')::boolean,false)
 THEN RAISE EXCEPTION 'meet_duty_confirmation'; END IF;

 SELECT coalesce(max(ordinal),0)+1 INTO next_ordinal FROM public.competition_appearances
 WHERE participant_id=person.id AND event_name=target_event.name;
 next_operation_key:=appearance.operation_key;
 -- Imported keys used the participant ID in every event. Preserve that key when
 -- free; a destination collision uses this appearance's permanent ID instead.
 IF EXISTS(SELECT 1 FROM public.competition_appearances WHERE competition_id=p_competition_id
  AND event_name=target_event.name AND operation_key=next_operation_key)
 THEN next_operation_key:=appearance.id::text; END IF;
 IF EXISTS(SELECT 1 FROM public.competition_appearances WHERE competition_id=p_competition_id
  AND event_name=target_event.name AND operation_key=next_operation_key)
 THEN RAISE EXCEPTION 'meet_conflict'; END IF;

 UPDATE public.competition_appearances SET event_name=target_event.name,ordinal=next_ordinal,operation_key=next_operation_key,
  qualification_mark=CASE WHEN p_command?'mark' THEN nullif(p_command->>'mark','') ELSE qualification_mark END,
  performance=(performance-'heatScope')||jsonb_build_object('group',NULL,'order',NULL),revision=revision+1
 WHERE id=appearance.id RETURNING to_jsonb(competition_appearances) INTO after_value;
 UPDATE public.competition_meet_events SET revision=revision+1
 WHERE competition_id=p_competition_id AND name IN (source_event.name,target_event.name);
 result:=jsonb_build_object('requestId',p_request_id,'id',appearance.id);
 INSERT INTO public.competition_meet_requests(id,competition_id,actor_id,actor_name,command,result,before_data,after_data)
 VALUES(p_request_id,p_competition_id,auth.uid(),(SELECT display_name FROM public.profiles WHERE id=auth.uid()),
  p_command,result,to_jsonb(appearance),after_value);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mutate_competition_meet(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_competition_meet(text,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';

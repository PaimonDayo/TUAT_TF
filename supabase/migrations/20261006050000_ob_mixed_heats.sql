-- Preserve every existing placement; add optional physical heat scope only on explicit edits.
-- No tables or data backfill; existing audit/failover/mirror JSON paths are retained.
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
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
  -- Recording permission must not grant group/lane/order changes.
  IF NOT (public.can_manage_system() OR public.can_manage_ob_meet()) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_data->'participants') person
    LEFT JOIN LATERAL (SELECT old FROM jsonb_array_elements(coalesce(target.data->'participants','[]'::jsonb)) old
      WHERE old->>'entryId'=person->>'entryId') previous ON true
    WHERE coalesce(person->'group','null'::jsonb) IS DISTINCT FROM coalesce(previous.old->'group','null'::jsonb)
       OR coalesce(person->'order','null'::jsonb) IS DISTINCT FROM coalesce(previous.old->'order','null'::jsonb)
       OR coalesce(person->>'heatScope',left(p_event,2)) IS DISTINCT FROM coalesce(previous.old->>'heatScope',left(p_event,2))
  ) THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
  IF (FOUND AND p_revision IS DISTINCT FROM target.revision) OR (NOT FOUND AND p_revision IS NOT NULL) THEN RAISE EXCEPTION 'operation_conflict'; END IF;
  base:=substring(p_event FROM 3); track:=base IN ('100m','300m','300mH','1500m','3000m'); height:=base='走り高跳び'; wind_allowed:=base IN ('100m','走り幅跳び'); confirmed:=(p_data->>'confirmed')::boolean;
  -- Lock registrations consulted below so entry edits cannot race validation.
  PERFORM 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' ORDER BY id FOR SHARE;
  FOR p IN SELECT value FROM jsonb_array_elements(p_data->'participants') LOOP
    IF jsonb_typeof(p)<>'object' OR jsonb_typeof(p->'entryId') IS DISTINCT FROM 'string'
      OR (p->>'entryId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR p->>'entryId'<>lower(p->>'entryId') OR p->>'entryId'=ANY(ids) OR p->>'status' IS NULL OR p->>'status' NOT IN ('entered','DNS','DNF','DQ')
      OR jsonb_typeof(p->'trials') IS DISTINCT FROM 'array'
      OR (p ? 'heatScope' AND (jsonb_typeof(p->'heatScope') IS DISTINCT FROM 'string' OR p->>'heatScope' NOT IN ('男子','女子','混合')))
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('entryId','group','order','status','trials','heatScope')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    ids:=array_append(ids,p->>'entryId');
    SELECT * INTO entry FROM public.ob_meet_entries WHERE id=(p->>'entryId')::uuid AND meet_key='ob-2026';
    IF NOT FOUND OR (NOT p_event=ANY(entry.events) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')) THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT p_event=ANY(entry.events) AND p->>'status'='entered'
      AND p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')
      THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT (p ? 'group' AND p ? 'order') OR EXISTS(SELECT 1 FROM (VALUES(p->'group',99),(p->'order',600)) v(n,maximum) WHERE n<>'null'::jsonb AND (jsonb_typeof(n)<>'number' OR (n#>>'{}') !~ '^[1-9][0-9]{0,2}$' OR (n#>>'{}')::numeric>maximum)) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    -- Absence preserves history, but cannot be used to resume or change a recorded run.
    IF entry.absent AND p->'trials' IS DISTINCT FROM coalesce((SELECT old->'trials' FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId'),'[]'::jsonb)
      THEN RAISE EXCEPTION 'operation_absent'; END IF;
    IF entry.absent AND p->>'status'='entered' AND p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')
      AND p IS DISTINCT FROM jsonb_build_object('entryId',entry.id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb) THEN RAISE EXCEPTION 'operation_absent'; END IF;
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
    IF confirmed AND NOT entry.absent AND p_event=ANY(entry.events) AND p->>'status'='entered' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'trials') a WHERE a->>'status' IN ('valid','foul')) THEN RAISE EXCEPTION 'operation_incomplete'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.ob_meet_entries e WHERE meet_key='ob-2026' AND p_event=ANY(e.events) AND NOT e.id::text=ANY(ids))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE NOT (old->>'entryId')=ANY(ids)) THEN RAISE EXCEPTION 'operation_roster'; END IF;
  IF target.event_name IS NOT NULL AND p_data IS NOT DISTINCT FROM target.data THEN RETURN to_jsonb(target); END IF;
  INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data,updated_at) VALUES('ob-2026',p_event,coalesce(target.revision+1,0),p_data,now())
    ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at RETURNING * INTO saved;
  INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES('ob-2026',p_event,auth.uid(),target.data,p_data);
  RETURN to_jsonb(saved);
END $$;

CREATE OR REPLACE FUNCTION public._save_ob_event_operation_checked_mixed(p_event text,p_revision integer,p_data jsonb,p_base_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_event_operations%ROWTYPE; merged jsonb; persons jsonb; proposed jsonb;
 original jsonb; current_person jsonb; next_person jsonb; field text; base_value jsonb; next_value jsonb; current_value jsonb;
 e record; changed boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_record_ob_meet() THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
 IF p_event IS NULL OR p_revision<0 OR p_data IS NULL OR jsonb_typeof(p_data)<>'object'
  OR jsonb_typeof(p_data->'participants') IS DISTINCT FROM 'array' OR jsonb_typeof(p_data->'confirmed') IS DISTINCT FROM 'boolean'
  OR pg_column_size(p_data)>250000 OR jsonb_array_length(p_data->'participants')>300
  OR (p_base_data IS NOT NULL AND (jsonb_typeof(p_base_data)<>'object' OR jsonb_typeof(p_base_data->'participants') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_base_data->'confirmed') IS DISTINCT FROM 'boolean' OR pg_column_size(p_base_data)>250000))
 THEN RAISE EXCEPTION 'operation_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'participants') a GROUP BY a->>'entryId' HAVING count(*)>1) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||p_event,0));
 SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
 IF target.revision IS DISTINCT FROM p_revision AND (p_base_data IS NULL OR target.event_name IS NULL OR p_revision>target.revision) THEN
  RAISE EXCEPTION 'operation_conflict' USING DETAIL=to_jsonb(target)::text;
 END IF;
 merged:=p_data;
 persons:=coalesce(target.data->'participants','[]'::jsonb);
 FOR proposed IN SELECT value FROM jsonb_array_elements(p_data->'participants') LOOP
  IF jsonb_typeof(proposed)<>'object' OR proposed->>'entryId' IS NULL THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  SELECT value INTO current_person FROM jsonb_array_elements(persons) WHERE value->>'entryId'=proposed->>'entryId';
  IF current_person IS NULL THEN
   persons:=persons||jsonb_build_array(proposed);
  ELSE
   next_person:=proposed;
   IF target.revision IS DISTINCT FROM p_revision THEN
    SELECT value INTO original FROM jsonb_array_elements(p_base_data->'participants') WHERE value->>'entryId'=proposed->>'entryId';
    original:=coalesce(original,jsonb_build_object('entryId',proposed->>'entryId','group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
    next_person:=current_person;
    FOREACH field IN ARRAY ARRAY['position','status','trials'] LOOP
     IF field='position' THEN
      base_value:=jsonb_build_array(original->'group',original->'order',coalesce(original->>'heatScope',left(p_event,2)));
      next_value:=jsonb_build_array(proposed->'group',proposed->'order',coalesce(proposed->>'heatScope',left(p_event,2)));
      current_value:=jsonb_build_array(current_person->'group',current_person->'order',coalesce(current_person->>'heatScope',left(p_event,2)));
     ELSE
      base_value:=original->field; next_value:=proposed->field; current_value:=current_person->field;
     END IF;
     IF next_value IS DISTINCT FROM base_value THEN
      IF current_value IS DISTINCT FROM base_value AND current_value IS DISTINCT FROM next_value THEN
       RAISE EXCEPTION 'operation_conflict' USING DETAIL=to_jsonb(target)::text;
      END IF;
      IF field='position' THEN next_person:=(next_person-'heatScope')||jsonb_build_object('group',proposed->'group','order',proposed->'order')||CASE WHEN proposed ? 'heatScope' THEN jsonb_build_object('heatScope',proposed->'heatScope') ELSE '{}'::jsonb END;
      ELSE next_person:=jsonb_set(next_person,ARRAY[field],next_value); END IF;
     END IF;
    END LOOP;
   END IF;
   SELECT coalesce(jsonb_agg(CASE WHEN value->>'entryId'=proposed->>'entryId' THEN next_person ELSE value END ORDER BY ordinal),'[]')
    INTO persons FROM jsonb_array_elements(persons) WITH ORDINALITY a(value,ordinal);
  END IF;
 END LOOP;
 IF target.revision IS DISTINCT FROM p_revision THEN
  -- A concurrent confirmation survives a no-op draft, but editing results reopens the event.
  changed:=persons IS DISTINCT FROM target.data->'participants';
  IF p_data->'confirmed' IS NOT DISTINCT FROM p_base_data->'confirmed' THEN
   merged:=jsonb_set(merged,'{confirmed}',CASE WHEN changed THEN 'false'::jsonb ELSE target.data->'confirmed' END);
  END IF;
 END IF;
 -- Registration may change while an operator has a draft open. Add only new blank rows.
 FOR e IN SELECT id FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND p_event=ANY(events) ORDER BY submitted_name,id LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(persons) a WHERE a->>'entryId'=e.id::text) THEN
   persons:=persons||jsonb_build_array(jsonb_build_object('entryId',e.id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
   merged:=jsonb_set(merged,'{confirmed}','false'::jsonb);
  END IF;
 END LOOP;
 merged:=jsonb_set(merged,'{participants}',persons);
 RETURN public._save_ob_event_operation_mixed(p_event,target.revision,merged);
END $$;


REVOKE ALL ON FUNCTION public._save_ob_event_operation_mixed(text,integer,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._save_ob_event_operation_checked_mixed(text,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated;

-- Cross-division checks belong to RPC transactions, not table triggers: failover
-- replay applies preserved JSON row snapshots without rerunning app operations.
CREATE OR REPLACE FUNCTION public._validate_ob_family_positions(p_family text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p
  WHERE o.meet_key='ob-2026' AND o.event_name IN ('男子'||p_family,'女子'||p_family)
   AND p->>'status'<>'DNS' AND p->'group'<>'null'::jsonb AND p->'order'<>'null'::jsonb
  GROUP BY coalesce(p->>'heatScope',left(o.event_name,2)),p->'group',p->'order' HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'operation_position'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._validate_ob_family_positions(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._ob_family_positions(p_family text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('event_name',o.event_name,'participants',
  (SELECT coalesce(jsonb_agg(p-'trials' ORDER BY ordinal),'[]') FROM jsonb_array_elements(o.data->'participants') WITH ORDINALITY a(p,ordinal)))
  ORDER BY o.event_name),'[]') FROM public.ob_event_operations o WHERE o.meet_key='ob-2026' AND o.event_name IN ('男子'||p_family,'女子'||p_family)
$$;
REVOKE ALL ON FUNCTION public._ob_family_positions(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._record_ob_family_context(p_family text,p_previous uuid[],p_before jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.ob_operation_changes SET before_data=coalesce(before_data,'{}')||jsonb_build_object('family_positions',p_before),
  after_data=after_data||jsonb_build_object('family_positions',public._ob_family_positions(p_family))
 WHERE meet_key='ob-2026' AND event_name IN ('男子'||p_family,'女子'||p_family) AND actor_id=auth.uid()
  AND changed_at=now() AND NOT id=ANY(p_previous);
END $$;
REVOKE ALL ON FUNCTION public._record_ob_family_context(text,uuid[],jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_ob_event_operation(p_event text,p_revision integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; previous uuid[]; positions jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 positions:=public._ob_family_positions(substring(p_event FROM 3));
 SELECT coalesce(array_agg(id),'{}') INTO previous FROM public.ob_operation_changes WHERE actor_id=auth.uid() AND changed_at=now();
 result:=public._save_ob_event_operation_mixed(p_event,p_revision,p_data);
 PERFORM public._validate_ob_family_positions(substring(p_event FROM 3));
 PERFORM public._record_ob_family_context(substring(p_event FROM 3),previous,positions);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_event_operation(text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_event_operation(text,integer,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_ob_event_operation_checked(p_event text,p_revision integer,p_data jsonb,p_base_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; previous uuid[]; positions jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 positions:=public._ob_family_positions(substring(p_event FROM 3));
 SELECT coalesce(array_agg(id),'{}') INTO previous FROM public.ob_operation_changes WHERE actor_id=auth.uid() AND changed_at=now();
 result:=public._save_ob_event_operation_checked_mixed(p_event,p_revision,p_data,p_base_data);
 PERFORM public._validate_ob_family_positions(substring(p_event FROM 3));
 PERFORM public._record_ob_family_context(substring(p_event FROM 3),previous,positions);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_event_operation_checked(text,integer,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_event_operation_checked(text,integer,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_ob_family_operation_checked(p_family text,p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request jsonb; saved jsonb; results jsonb:='[]'; event text; target public.ob_event_operations%ROWTYPE; previous uuid[]; positions jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_record_ob_meet() THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
 IF p_family IS NULL OR p_family NOT IN ('100m','300m','300mH','1500m','3000m','走り幅跳び','走り高跳び','立ち五段','砲丸投げ','やり投げ','ジャベリックスロー')
  OR jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations)<>2 OR pg_column_size(p_operations)>550000
  OR (SELECT count(DISTINCT value->>'event') FROM jsonb_array_elements(p_operations))<>2
 THEN RAISE EXCEPTION 'operation_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 positions:=public._ob_family_positions(p_family);
 SELECT coalesce(array_agg(id),'{}') INTO previous FROM public.ob_operation_changes WHERE actor_id=auth.uid() AND changed_at=now();
 FOR request IN SELECT value FROM jsonb_array_elements(p_operations) ORDER BY value->>'event' LOOP
  event:=request->>'event';
  IF event NOT IN ('男子'||p_family,'女子'||p_family)
   OR jsonb_typeof(request) IS DISTINCT FROM 'object'
   OR NOT (request ?& ARRAY['event','revision','data','baseData'])
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(request) k WHERE k NOT IN ('event','revision','data','baseData'))
   OR request->'revision'<>'null'::jsonb AND (jsonb_typeof(request->'revision')<>'number' OR (request->>'revision') !~ '^[0-9]+$')
   OR jsonb_typeof(request->'data') IS DISTINCT FROM 'object' OR jsonb_typeof(request->'baseData') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event FOR UPDATE;
  -- Do not create an empty opposite-division event merely by saving this family.
  IF target.event_name IS NULL AND request->'data'='{"participants":[],"confirmed":false}'::jsonb
   AND request->'baseData'=request->'data'
   AND NOT EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND event=ANY(events)) THEN CONTINUE; END IF;
  saved:=public._save_ob_event_operation_checked_mixed(event,(request->>'revision')::integer,request->'data',request->'baseData');
  results:=results||jsonb_build_array(saved);
 END LOOP;
 PERFORM public._validate_ob_family_positions(p_family);
 PERFORM public._record_ob_family_context(p_family,previous,positions);
 RETURN jsonb_build_object('operations',results);
END $$;
REVOKE ALL ON FUNCTION public.save_ob_family_operation_checked(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_family_operation_checked(text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';


-- Service-only recovery preserves both same-transaction event snapshots together.
CREATE OR REPLACE FUNCTION public.replay_ob_family_operations(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row jsonb; target public.ob_event_operations%ROWTYPE; family text; event text; count integer:=0;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2 OR pg_column_size(p_rows)>550000
  OR (SELECT count(DISTINCT value->>'event_name') FROM jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'event_name' LOOP
  event:=row->>'event_name';
  IF row->>'meet_key' IS DISTINCT FROM 'ob-2026' OR event IS NULL
   OR event !~ '^(男子|女子)(100m|300m|300mH|1500m|3000m|走り幅跳び|走り高跳び|立ち五段|砲丸投げ|やり投げ|ジャベリックスロー)$'
   OR jsonb_typeof(row->'revision') IS DISTINCT FROM 'number' OR (row->>'revision') !~ '^[0-9]+$'
   OR jsonb_typeof(row->'data') IS DISTINCT FROM 'object' OR jsonb_typeof(row->'data'->'participants') IS DISTINCT FROM 'array'
   OR jsonb_typeof(row->'data'->'confirmed') IS DISTINCT FROM 'boolean' OR jsonb_array_length(row->'data'->'participants')>300
   OR jsonb_typeof(row->'updated_at') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  IF family IS NOT NULL AND family<>substring(event FROM 3) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  family:=substring(event FROM 3);
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event FOR UPDATE;
  IF target.event_name IS NOT NULL AND (target.revision>(row->>'revision')::integer
    OR target.revision=(row->>'revision')::integer AND target.data IS DISTINCT FROM row->'data') THEN RAISE EXCEPTION 'operation_replay_conflict'; END IF;
  IF target.event_name IS NOT NULL AND target.revision=(row->>'revision')::integer THEN CONTINUE; END IF;
  INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data,updated_at)
   VALUES('ob-2026',event,(row->>'revision')::integer,row->'data',(row->>'updated_at')::timestamptz)
   ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at;
  count:=count+1;
 END LOOP;
 PERFORM public._validate_ob_family_positions(family);
 RETURN jsonb_build_object('applied',count);
END $$;
REVOKE ALL ON FUNCTION public.replay_ob_family_operations(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replay_ob_family_operations(jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';

-- Day additions reserve positions across the physical heat, including opposite-source snapshots.
CREATE OR REPLACE FUNCTION public.add_ob_day_entry(p_request_id uuid,p_event text,p_entry_id uuid,p_revision integer,p_name text,p_grade text,p_group integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ob_meet_entries%ROWTYPE; target public.ob_event_operations%ROWTYPE; previous public.ob_operation_changes%ROWTYPE;
 request jsonb; saved jsonb; result jsonb; persons jsonb; person jsonb; next_order integer; entry_uuid uuid; existing_group integer; positions jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_event IS NULL OR p_event !~ '^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$'
  OR (p_group IS NOT NULL AND p_group NOT BETWEEN 1 AND 99)
  OR (p_entry_id IS NULL AND (p_revision IS NOT NULL OR p_name IS NULL OR p_grade IS NULL))
  OR (p_entry_id IS NOT NULL AND (p_revision IS NULL OR p_revision<0 OR p_name IS NOT NULL OR p_grade IS NOT NULL))
 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 request:=jsonb_build_object('event',p_event,'entryId',p_entry_id,'revision',p_revision,'name',p_name,'grade',p_grade,'group',p_group);
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/day-entry/'||p_request_id,0));
 SELECT * INTO previous FROM public.ob_operation_changes WHERE request_id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM auth.uid() OR previous.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'operation_request'; END IF;
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event;
  RETURN jsonb_build_object('entryId',previous.request_result->>'entryId','saved',to_jsonb(target));
 END IF;
 -- Use the same lock order as entry checking, attendance and operation saving.
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||p_event,0));
 positions:=public._ob_family_positions(substring(p_event FROM 3));
 SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
 IF coalesce((target.data->>'confirmed')::boolean,false) THEN RAISE EXCEPTION 'operation_confirmed'; END IF;
 IF p_group IS NOT NULL AND EXISTS(SELECT 1 FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p
   WHERE o.meet_key='ob-2026' AND o.event_name IN ('男子'||substring(p_event FROM 3),'女子'||substring(p_event FROM 3))
    AND coalesce(p->>'heatScope',left(o.event_name,2))=left(p_event,2) AND (p->>'group')::integer=p_group AND (p->>'status' IN ('DNF','DQ') OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(p->'trials') t WHERE t->>'status'<>'pending' OR t->>'mark'<>'' OR t->>'wind'<>''))) THEN
  RAISE EXCEPTION 'operation_started';
 END IF;
 IF p_entry_id IS NULL THEN
  entry_uuid:=public.create_ob_guest_registration(p_name,p_grade,ARRAY[p_event],'{}','未回答',NULL,NULL);
 ELSE
  SELECT * INTO e FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
  IF NOT FOUND OR e.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
  IF e.absent THEN RAISE EXCEPTION 'entry_absent'; END IF;
  entry_uuid:=e.id;
  IF NOT p_event=ANY(e.events) THEN
   -- Existing entry validation keeps division, identity, audit and qualifying marks intact.
   PERFORM public.save_ob_entry(e.id,NULL,e.revision,array_append(e.events,p_event),e.qualification_marks);
  END IF;
 END IF;
 persons:=coalesce(target.data->'participants','[]'::jsonb);
 SELECT value INTO person FROM jsonb_array_elements(persons) WHERE value->>'entryId'=entry_uuid::text;
 IF person IS NOT NULL THEN
  -- Re-registration never silently clears DNS, trials or deliberately chosen assignments.
  IF person->>'status'<>'entered' OR EXISTS(SELECT 1 FROM jsonb_array_elements(person->'trials') t WHERE t->>'status'<>'pending' OR t->>'mark'<>'' OR t->>'wind'<>'') THEN RAISE EXCEPTION 'operation_existing'; END IF;
  existing_group:=(person->>'group')::integer;
  IF (existing_group IS NOT NULL OR person->>'order' IS NOT NULL) AND p_group IS DISTINCT FROM existing_group THEN RAISE EXCEPTION 'operation_existing'; END IF;
 ELSE
  person:=jsonb_build_object('entryId',entry_uuid,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb);
 END IF;
 IF p_group IS NOT NULL AND person->>'group' IS NULL AND person->>'order' IS NULL THEN
  -- Reserve numbers already printed for DNS/absent people too.
  SELECT n INTO next_order FROM generate_series(1,600) n WHERE NOT EXISTS(
   SELECT 1 FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p
    WHERE o.meet_key='ob-2026' AND o.event_name IN ('男子'||substring(p_event FROM 3),'女子'||substring(p_event FROM 3))
     AND coalesce(p->>'heatScope',left(o.event_name,2))=left(p_event,2) AND (p->>'group')::integer=p_group AND (p->>'order')::integer=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'operation_position'; END IF;
  person:=person||jsonb_build_object('group',p_group,'order',next_order);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(persons) p WHERE p->>'entryId'=entry_uuid::text) THEN
  SELECT jsonb_agg(CASE WHEN value->>'entryId'=entry_uuid::text THEN person ELSE value END ORDER BY ordinal) INTO persons
   FROM jsonb_array_elements(persons) WITH ORDINALITY a(value,ordinal);
 ELSE persons:=persons||jsonb_build_array(person); END IF;
 saved:=public.save_ob_event_operation_checked(p_event,target.revision,jsonb_build_object('participants',persons,'confirmed',false),NULL);
 result:=jsonb_build_object('entryId',entry_uuid,'saved',saved);
 INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data,request_id,request_payload,request_result)
 VALUES('ob-2026',p_event,auth.uid(),coalesce(target.data,'{}')||jsonb_build_object('family_positions',positions),
  (saved->'data')||jsonb_build_object('family_positions',public._ob_family_positions(substring(p_event FROM 3))),p_request_id,request,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.add_ob_day_entry(uuid,text,uuid,integer,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_ob_day_entry(uuid,text,uuid,integer,text,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';

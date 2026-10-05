-- Only authenticated approved active members may record without a helper assignment.
-- OB/OG participant publishing is deferred; no anonymous table grants.
-- No new tables: existing audit/failover logging and cloud-mirror tables are unchanged.
CREATE OR REPLACE FUNCTION public.can_record_ob_meet() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.can_manage_system() OR public.can_manage_ob_meet() OR EXISTS (
   SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved AND status='active'
 );
$$;
REVOKE ALL ON FUNCTION public.can_record_ob_meet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_record_ob_meet() TO authenticated;
DROP POLICY IF EXISTS ob_operations_record_read ON public.ob_event_operations;
CREATE POLICY ob_operations_record_read ON public.ob_event_operations FOR SELECT TO authenticated USING (public.can_record_ob_meet());

CREATE OR REPLACE FUNCTION public.save_ob_event_operation(p_event text,p_revision integer,p_data jsonb)
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
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('entryId','group','order','status','trials')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    ids:=array_append(ids,p->>'entryId');
    SELECT * INTO entry FROM public.ob_meet_entries WHERE id=(p->>'entryId')::uuid AND meet_key='ob-2026';
    IF NOT FOUND OR (NOT p_event=ANY(entry.events) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')) THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT p_event=ANY(entry.events) AND p->>'status'='entered'
      AND p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')
      THEN RAISE EXCEPTION 'operation_roster'; END IF;
    IF NOT (p ? 'group' AND p ? 'order') OR EXISTS(SELECT 1 FROM (VALUES(p->'group',99),(p->'order',300)) v(n,maximum) WHERE n<>'null'::jsonb AND (jsonb_typeof(n)<>'number' OR (n#>>'{}') !~ '^[1-9][0-9]{0,2}$' OR (n#>>'{}')::numeric>maximum)) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    -- Absence preserves history, but cannot be used to resume or change a recorded run.
    IF entry.absent AND p->'trials' IS DISTINCT FROM coalesce((SELECT old->'trials' FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId'),'[]'::jsonb)
      THEN RAISE EXCEPTION 'operation_absent'; END IF;
    IF entry.absent AND p->>'status'='entered' AND p IS DISTINCT FROM (SELECT old FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')
      AND p IS DISTINCT FROM jsonb_build_object('entryId',entry.id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb) THEN RAISE EXCEPTION 'operation_absent'; END IF;
    IF p->>'group' IS NOT NULL AND p->>'order' IS NOT NULL AND p->>'status'<>'DNS' THEN
      position_key:=(p->>'group')||':'||(p->>'order');
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
  INSERT INTO public.ob_event_operations(meet_key,event_name,revision,data,updated_at) VALUES('ob-2026',p_event,coalesce(target.revision+1,0),p_data,now())
    ON CONFLICT(meet_key,event_name) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at RETURNING * INTO saved;
  INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data) VALUES('ob-2026',p_event,auth.uid(),target.data,p_data);
  RETURN to_jsonb(saved);
END $$;

CREATE OR REPLACE FUNCTION public.save_ob_event_operation_checked(p_event text,p_revision integer,p_data jsonb,p_base_data jsonb DEFAULT NULL)
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
      base_value:=jsonb_build_array(original->'group',original->'order');
      next_value:=jsonb_build_array(proposed->'group',proposed->'order');
      current_value:=jsonb_build_array(current_person->'group',current_person->'order');
     ELSE
      base_value:=original->field; next_value:=proposed->field; current_value:=current_person->field;
     END IF;
     IF next_value IS DISTINCT FROM base_value THEN
      IF current_value IS DISTINCT FROM base_value AND current_value IS DISTINCT FROM next_value THEN
       RAISE EXCEPTION 'operation_conflict' USING DETAIL=to_jsonb(target)::text;
      END IF;
      IF field='position' THEN next_person:=next_person||jsonb_build_object('group',proposed->'group','order',proposed->'order');
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
 RETURN public.save_ob_event_operation(p_event,target.revision,merged);
END $$;

NOTIFY pgrst, 'reload schema';

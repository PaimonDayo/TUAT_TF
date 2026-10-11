-- Two appearances share one registration/person, preserving all existing UUIDs and data.
-- The second uses UUID:2 in the existing operation JSON. No tables or backfill.
CREATE OR REPLACE FUNCTION public._ob_appearance_entry_id(p_id text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $$
BEGIN
 IF p_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:2)?$' THEN RAISE EXCEPTION 'operation_invalid'; END IF;
 RETURN split_part(p_id,':',1)::uuid;
END $$;
CREATE OR REPLACE FUNCTION public._ob_appearance_registered(p_events text[],p_event text,p_id text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (SELECT count(*) FROM unnest(p_events) event WHERE event=p_event)>=CASE WHEN right(p_id,2)=':2' THEN 2 ELSE 1 END
$$;
REVOKE ALL ON FUNCTION public._ob_appearance_entry_id(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._ob_appearance_registered(text[],text,text) FROM PUBLIC,anon,authenticated;

-- Also guard direct imports and private sheet edits; existing rows remain untouched.
CREATE OR REPLACE FUNCTION public.guard_ob_entry_count() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF cardinality(NEW.events)>22 OR EXISTS(SELECT 1 FROM unnest(NEW.events) event GROUP BY event HAVING count(*)>2) THEN RAISE EXCEPTION 'entry_limit'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_ob_entry_count() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ob_entry_count_guard ON public.ob_meet_entries;
CREATE TRIGGER ob_entry_count_guard BEFORE INSERT OR UPDATE OF events ON public.ob_meet_entries FOR EACH ROW EXECUTE FUNCTION public.guard_ob_entry_count();


CREATE OR REPLACE FUNCTION public.save_ob_entry(p_entry_id uuid, p_profile_id uuid, p_revision integer, p_events text[], p_marks jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  target public.ob_meet_entries%ROWTYPE;
  member public.profiles%ROWTYPE;
  allowed text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  -- 係（システム・OB戦2026ロール）は誰の分でも、一般部員は自分の分だけ登録・編集できる。
  IF NOT public.can_manage_ob_meet() AND NOT (
    (p_entry_id IS NULL AND p_profile_id=auth.uid())
    OR (p_entry_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ob_meet_entries x WHERE x.id=p_entry_id AND x.meet_key='ob-2026' AND x.profile_id=auth.uid()))
  ) THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  SELECT array_agg(g.prefix || e.event) INTO allowed
  FROM (VALUES ('男子'),('女子')) g(prefix)
  CROSS JOIN (VALUES ('100m'),('300m'),('300mH'),('1500m'),('3000m'),('走り幅跳び'),('走り高跳び'),('立ち五段'),('砲丸投げ'),('やり投げ'),('ジャベリックスロー')) e(event);
  IF p_events IS NULL OR cardinality(p_events)>22 OR array_position(p_events,NULL) IS NOT NULL
    OR NOT p_events <@ allowed OR EXISTS(SELECT 1 FROM unnest(p_events) x GROUP BY x HAVING count(*)>2)
    OR p_marks IS NULL OR jsonb_typeof(p_marks)<>'object' THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_marks) m WHERE NOT m.key=ANY(p_events)
    OR jsonb_typeof(m.value) NOT IN ('null','string') OR length(m.value #>> '{}')>1000) THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  -- Serialize roster edits with day registration, attendance, duties and operation reconciliation.
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
  IF p_entry_id IS NULL THEN
    IF p_profile_id IS NULL OR p_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_invalid'; END IF;
    SELECT * INTO member FROM public.profiles WHERE id=p_profile_id AND approved AND status='active';
    IF NOT FOUND OR btrim(member.display_name)='' OR member.grade IS NULL THEN RAISE EXCEPTION 'entry_member_missing'; END IF;
    IF EXISTS(SELECT 1 FROM public.ob_meet_entries e WHERE e.meet_key='ob-2026' AND
      (e.profile_id=p_profile_id OR regexp_replace(normalize(e.submitted_name,NFKC),'[[:space:]　]','','g')=regexp_replace(normalize(member.display_name,NFKC),'[[:space:]　]','','g')))
      THEN RAISE EXCEPTION 'entry_duplicate' USING ERRCODE='23505'; END IF;
    INSERT INTO public.ob_meet_entries(meet_key,submitted_name,grade,events,qualification_marks,profile_id)
    VALUES('ob-2026',member.display_name,CASE WHEN member.grade IN ('1','2','3','4') THEN 'B'||member.grade ELSE member.grade END,p_events,p_marks,p_profile_id)
    RETURNING * INTO target;
  ELSE
    IF p_profile_id IS NOT NULL OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
    SELECT * INTO target FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'entry_missing'; END IF;
    IF target.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
    IF target.events=p_events AND target.qualification_marks=p_marks THEN RETURN target.id; END IF;
    UPDATE public.ob_meet_entries SET events=p_events,qualification_marks=p_marks,revision=revision+1 WHERE id=target.id;
  END IF;
  RETURN target.id;
END $$;

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
      OR (p->>'entryId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:2)?$'
      OR p->>'entryId'<>lower(p->>'entryId') OR p->>'entryId'=ANY(ids) OR p->>'status' IS NULL OR p->>'status' NOT IN ('entered','DNS','DNF','DQ')
      OR jsonb_typeof(p->'trials') IS DISTINCT FROM 'array'
      OR (p ? 'heatScope' AND (jsonb_typeof(p->'heatScope') IS DISTINCT FROM 'string' OR p->>'heatScope' NOT IN ('男子','女子','混合')))
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('entryId','group','order','status','trials','heatScope')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
    ids:=array_append(ids,p->>'entryId');
    SELECT * INTO entry FROM public.ob_meet_entries WHERE id=public._ob_appearance_entry_id(p->>'entryId') AND meet_key='ob-2026';
    IF NOT FOUND OR (NOT public._ob_appearance_registered(entry.events,p_event,p->>'entryId') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') old WHERE old->>'entryId'=p->>'entryId')) THEN RAISE EXCEPTION 'operation_roster'; END IF;
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
 FOR e IN SELECT roster.id::text||CASE WHEN n=2 THEN ':2' ELSE '' END id FROM public.ob_meet_entries roster CROSS JOIN LATERAL generate_series(1,(SELECT count(*)::integer FROM unnest(roster.events) event WHERE event=p_event)) n WHERE meet_key='ob-2026' ORDER BY submitted_name,roster.id,n LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(persons) a WHERE a->>'entryId'=e.id::text) THEN
   persons:=persons||jsonb_build_array(jsonb_build_object('entryId',e.id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
   merged:=jsonb_set(merged,'{confirmed}','false'::jsonb);
  END IF;
 END LOOP;
 merged:=jsonb_set(merged,'{participants}',persons);
 RETURN public._save_ob_event_operation_mixed(p_event,target.revision,merged);
END $$;

CREATE OR REPLACE FUNCTION public.add_ob_day_entry(p_request_id uuid,p_event text,p_entry_id uuid,p_revision integer,p_name text,p_grade text,p_group integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ob_meet_entries%ROWTYPE; target public.ob_event_operations%ROWTYPE; previous public.ob_operation_changes%ROWTYPE;
 request jsonb; saved jsonb; result jsonb; persons jsonb; person jsonb; next_order integer; entry_uuid uuid; existing_group integer; positions jsonb; appearance_id text; entry_count integer;
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
 IF p_entry_id IS NULL THEN
  entry_uuid:=public.create_ob_guest_registration(p_name,p_grade,ARRAY[p_event],'{}','未回答',NULL,NULL);
 ELSE
  SELECT * INTO e FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
  IF NOT FOUND OR e.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
  IF e.absent THEN RAISE EXCEPTION 'entry_absent'; END IF;
  entry_uuid:=e.id;
  SELECT count(*) INTO entry_count FROM unnest(e.events) event WHERE event=p_event;
  IF entry_count>=2 THEN RAISE EXCEPTION 'entry_limit'; END IF;
  PERFORM public.save_ob_entry(e.id,NULL,e.revision,array_append(e.events,p_event),e.qualification_marks);
 END IF;
 appearance_id:=entry_uuid::text||CASE WHEN entry_count=1 THEN ':2' ELSE '' END;
 persons:=coalesce(target.data->'participants','[]'::jsonb);
 SELECT value INTO person FROM jsonb_array_elements(persons) WHERE value->>'entryId'=appearance_id;
 IF person IS NOT NULL THEN
  -- Re-registration never silently clears DNS, trials or deliberately chosen assignments.
  IF person->>'status'<>'entered' OR EXISTS(SELECT 1 FROM jsonb_array_elements(person->'trials') t WHERE t->>'status'<>'pending' OR t->>'mark'<>'' OR t->>'wind'<>'') THEN RAISE EXCEPTION 'operation_existing'; END IF;
  existing_group:=(person->>'group')::integer;
  IF (existing_group IS NOT NULL OR person->>'order' IS NOT NULL) AND p_group IS DISTINCT FROM existing_group THEN RAISE EXCEPTION 'operation_existing'; END IF;
 ELSE
  person:=jsonb_build_object('entryId',appearance_id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb);
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
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(persons) p WHERE p->>'entryId'=appearance_id) THEN
  SELECT jsonb_agg(CASE WHEN value->>'entryId'=appearance_id THEN person ELSE value END ORDER BY ordinal) INTO persons
   FROM jsonb_array_elements(persons) WITH ORDINALITY a(value,ordinal);
 ELSE persons:=persons||jsonb_build_array(person); END IF;
 saved:=public.save_ob_event_operation_checked(p_event,target.revision,jsonb_build_object('participants',persons,'confirmed',false),NULL);
 result:=jsonb_build_object('entryId',appearance_id,'saved',saved);
 INSERT INTO public.ob_operation_changes(meet_key,event_name,actor_id,before_data,after_data,request_id,request_payload,request_result)
 VALUES('ob-2026',p_event,auth.uid(),coalesce(target.data,'{}')||jsonb_build_object('family_positions',positions),
  (saved->'data')||jsonb_build_object('family_positions',public._ob_family_positions(substring(p_event FROM 3))),p_request_id,request,result);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.save_ob_entry_duty_roles(p_entry_id uuid,p_slot_time text,p_event_name text,p_role_ids uuid[],p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ob_meet_entries%ROWTYPE; d public.ob_entry_duties%ROWTYPE;
 legacy public.ob_meet_duties%ROWTYPE; r public.ob_duty_roles%ROWTYPE;
 entry_storage boolean; current_revision integer; old_roles uuid[]; label text; used integer; rev integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_role_ids IS NULL OR cardinality(p_role_ids)>20 OR EXISTS(SELECT 1 FROM unnest(p_role_ids) x WHERE x IS NULL)
  OR cardinality(p_role_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_role_ids) x)
  OR p_revision<0 OR NOT EXISTS(SELECT 1 FROM public.ob_duty_event_slots WHERE slot_time=p_slot_time AND event_name=p_event_name)
 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 -- One shared lock covers both storage tables, capacity edits and simultaneous event assignment.
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT * INTO e FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'entry_helper_ineligible'; END IF;
 IF cardinality(p_role_ids)>0 AND (e.grade='OB・OG' OR (e.profile_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.profiles WHERE id=e.profile_id AND approved AND status='active')))
 THEN RAISE EXCEPTION 'entry_helper_ineligible'; END IF;
 SELECT * INTO d FROM public.ob_entry_duties WHERE meet_key='ob-2026' AND entry_id=e.id AND slot_time=p_slot_time AND event_name=p_event_name FOR UPDATE;
 SELECT * INTO legacy FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=e.profile_id AND slot_time=p_slot_time AND event_name=p_event_name FOR UPDATE;
 IF d.entry_id IS NOT NULL AND legacy.profile_id IS NOT NULL AND (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'') AND (cardinality(legacy.role_ids)>0 OR btrim(legacy.assignment)<>'') THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 entry_storage := e.profile_id IS NULL OR (d.entry_id IS NOT NULL AND
  (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'' OR legacy.profile_id IS NULL OR (cardinality(legacy.role_ids)=0 AND btrim(legacy.assignment)='')));
 current_revision := CASE WHEN entry_storage THEN d.revision ELSE legacy.revision END;
 old_roles := coalesce(CASE WHEN entry_storage THEN d.role_ids ELSE legacy.role_ids END,'{}');
 IF current_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 IF cardinality(p_role_ids)<>(SELECT count(*) FROM public.ob_duty_roles WHERE id=ANY(p_role_ids) AND meet_key='ob-2026' AND slot_time=p_slot_time AND event_name=p_event_name) THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 -- Permit removals from a historical conflicting assignment, but never new additions.
 IF cardinality(p_role_ids)>0 AND NOT (p_role_ids<@old_roles) THEN
  IF e.absent THEN RAISE EXCEPTION 'entry_absent'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(e.events) event JOIN public.ob_duty_event_slots s
   ON s.slot_time=p_slot_time AND s.event_name=CASE substring(event FROM 3) WHEN '立ち五段' THEN '立ち五段跳び' ELSE substring(event FROM 3) END)
   OR EXISTS(SELECT 1 FROM public.ob_event_operations o JOIN public.ob_duty_event_slots s
    ON s.slot_time=p_slot_time AND s.event_name=CASE substring(o.event_name FROM 3) WHEN '立ち五段' THEN '立ち五段跳び' ELSE substring(o.event_name FROM 3) END,
    jsonb_array_elements(o.data->'participants') participant
    WHERE o.meet_key='ob-2026' AND participant->>'entryId' IN (e.id::text,e.id::text||':2') AND (
     participant->>'status' IN ('DNF','DQ') OR EXISTS(SELECT 1 FROM jsonb_array_elements(participant->'trials') trial
      WHERE trial->>'status'<>'pending' OR trial->>'mark'<>'' OR trial->>'wind'<>'')))
  THEN RAISE EXCEPTION 'entry_competing'; END IF;
  IF EXISTS(SELECT 1 FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=e.profile_id AND slot_time=p_slot_time AND event_name<>p_event_name AND (cardinality(role_ids)>0 OR btrim(assignment)<>''))
   OR EXISTS(SELECT 1 FROM public.ob_entry_duties WHERE meet_key='ob-2026' AND entry_id=e.id AND slot_time=p_slot_time AND event_name<>p_event_name AND (cardinality(role_ids)>0 OR btrim(assignment)<>''))
  THEN RAISE EXCEPTION 'entry_duty_busy'; END IF;
 END IF;
 FOR r IN SELECT * FROM public.ob_duty_roles WHERE id=ANY(p_role_ids) LOOP
  SELECT count(*) INTO used FROM (
   SELECT profile_id::text person FROM public.ob_meet_duties WHERE r.id=ANY(role_ids) AND profile_id IS DISTINCT FROM e.profile_id
   UNION ALL SELECT entry_id::text FROM public.ob_entry_duties WHERE r.id=ANY(role_ids) AND entry_id<>e.id
  ) assigned;
  IF used>=r.required_count AND NOT r.id=ANY(old_roles) THEN RAISE EXCEPTION 'role_full'; END IF;
 END LOOP;
 SELECT coalesce(string_agg(name,'・' ORDER BY name),'') INTO label FROM public.ob_duty_roles WHERE id=ANY(p_role_ids);
 IF length(label)>200 THEN RAISE EXCEPTION 'role_names_too_long'; END IF;
 rev := coalesce(current_revision+1,0);
 IF entry_storage THEN
  INSERT INTO public.ob_entry_duties(meet_key,entry_id,slot_time,event_name,assignment,role_ids,revision)
   VALUES('ob-2026',e.id,p_slot_time,p_event_name,label,p_role_ids,rev)
   ON CONFLICT(meet_key,entry_id,slot_time,event_name) DO UPDATE SET assignment=excluded.assignment,role_ids=excluded.role_ids,revision=excluded.revision;
 ELSE
  INSERT INTO public.ob_meet_duties(meet_key,profile_id,slot_time,event_name,assignment,role_ids,revision)
   VALUES('ob-2026',e.profile_id,p_slot_time,p_event_name,label,p_role_ids,rev)
   ON CONFLICT(meet_key,profile_id,slot_time,event_name) DO UPDATE SET assignment=excluded.assignment,role_ids=excluded.role_ids,revision=excluded.revision;
 END IF;
 RETURN rev;
END $$;

CREATE OR REPLACE FUNCTION public.delete_ob_registration(p_entry_id uuid,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ob_meet_entries%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 SELECT * INTO e FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
 IF NOT FOUND OR e.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 -- Duties must be explicitly unassigned first. Do not remove saved race results.
 IF EXISTS(SELECT 1 FROM public.ob_entry_duties WHERE entry_id=e.id AND (assignment<>'' OR cardinality(role_ids)>0))
 OR EXISTS(SELECT 1 FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=e.profile_id AND (assignment<>'' OR cardinality(role_ids)>0))
 THEN RAISE EXCEPTION 'entry_has_duties'; END IF;
 IF EXISTS(SELECT 1 FROM public.ob_event_operations o, jsonb_array_elements(o.data->'participants') p
   WHERE o.meet_key='ob-2026' AND p->>'entryId' IN (e.id::text,e.id::text||':2'))
 THEN RAISE EXCEPTION 'entry_has_operations'; END IF;
 -- Preserve party response and its audit; deleting a race entry does not cancel dinner.
 UPDATE public.ob_party_responses SET entry_id=NULL,revision=revision+1 WHERE entry_id=e.id;
 INSERT INTO public.ob_entry_changes(entry_id,actor_id,before_data,after_data)
 VALUES(NULL,auth.uid(),to_jsonb(e),to_jsonb(e)||jsonb_build_object('change_type','entry_deleted'));
 DELETE FROM public.ob_meet_entries WHERE id=e.id;
 RETURN e.id;
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

NOTIFY pgrst,'reload schema';

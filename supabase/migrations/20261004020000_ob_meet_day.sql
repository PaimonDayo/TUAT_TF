-- Tournament day: keep existing registrations, duties, marks, audits and failover triggers.
-- Existing tables are mirrored with select *, so these columns are replayed by the same mirror.
ALTER TABLE public.ob_meet_entries ADD COLUMN IF NOT EXISTS absent boolean NOT NULL DEFAULT false;
ALTER TABLE public.ob_operation_changes ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.ob_operation_changes ADD COLUMN IF NOT EXISTS request_payload jsonb;
ALTER TABLE public.ob_operation_changes ADD COLUMN IF NOT EXISTS request_result jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS ob_operation_request_unique ON public.ob_operation_changes(request_id) WHERE request_id IS NOT NULL;
DROP POLICY IF EXISTS ob_operations_staff_read ON public.ob_event_operations;
CREATE POLICY ob_operations_staff_read ON public.ob_event_operations FOR SELECT TO authenticated USING (public.can_manage_ob_meet());

CREATE OR REPLACE FUNCTION public.set_ob_attendance(p_entry_id uuid,p_revision integer,p_absent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ob_meet_entries%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_entry_id IS NULL OR p_revision IS NULL OR p_revision<0 OR p_absent IS NULL THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT * INTO e FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
 IF NOT FOUND OR p_revision>e.revision OR (e.revision<>p_revision AND e.absent IS DISTINCT FROM p_absent) THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 IF e.absent IS DISTINCT FROM p_absent THEN
  UPDATE public.ob_meet_entries SET absent=p_absent,revision=revision+1 WHERE id=e.id RETURNING * INTO e;
 END IF;
 -- ob_entry_change_log audits the new flag; no event/duty/performance is removed or relabelled.
 RETURN jsonb_build_object('entryId',e.id,'revision',e.revision,'absent',e.absent);
END $$;
REVOKE ALL ON FUNCTION public.set_ob_attendance(uuid,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_ob_attendance(uuid,integer,boolean) TO authenticated;

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
    OR NOT p_events <@ allowed OR cardinality(p_events)<>(SELECT count(DISTINCT x) FROM unnest(p_events) x)
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

REVOKE ALL ON FUNCTION public.save_ob_entry(uuid,uuid,integer,text[],jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_entry(uuid,uuid,integer,text[],jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_ob_event_operation(p_event text,p_revision integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  target public.ob_event_operations%ROWTYPE; saved public.ob_event_operations%ROWTYPE;
  p jsonb; t jsonb; entry public.ob_meet_entries%ROWTYPE;
  ids text[]:='{}'; places text[]:='{}'; position_key text; base text;
  track boolean; height boolean; wind_allowed boolean; confirmed boolean;
  mark text; wind text; state text; parts text[];
BEGIN
  IF auth.uid() IS NULL OR NOT (public.can_manage_system() OR public.can_manage_ob_meet()) THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
  IF p_event IS NULL OR p_event !~ '^(男子|女子)(1500m|ジャベリックスロー|立ち五段|100m|砲丸投げ|300mH|走り高跳び|300m|やり投げ|走り幅跳び|3000m)$'
    OR p_revision<0 OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR pg_column_size(p_data)>250000
    OR jsonb_typeof(p_data->'participants') IS DISTINCT FROM 'array' OR jsonb_typeof(p_data->'confirmed') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  IF jsonb_array_length(p_data->'participants')>300 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('participants','confirmed')) THEN RAISE EXCEPTION 'operation_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
  -- Serialize initial inserts as well as updates; the expected revision prevents lost updates.
  PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026:operations:'||p_event,0));
  SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
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
REVOKE ALL ON FUNCTION public.save_ob_event_operation(text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_event_operation(text,integer,jsonb) TO authenticated;

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
    WHERE o.meet_key='ob-2026' AND participant->>'entryId'=e.id::text AND (
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


-- Compare a submitted draft to the exact client base. A position (group+order) is one value;
-- status and the trial list can merge independently. True divergent edits return the latest row.
CREATE OR REPLACE FUNCTION public.save_ob_event_operation_checked(p_event text,p_revision integer,p_data jsonb,p_base_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_event_operations%ROWTYPE; merged jsonb; persons jsonb; proposed jsonb;
 original jsonb; current_person jsonb; next_person jsonb; field text; base_value jsonb; next_value jsonb; current_value jsonb;
 e record; changed boolean:=false;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.can_manage_system() OR public.can_manage_ob_meet()) THEN RAISE EXCEPTION 'operation_forbidden' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION public.save_ob_event_operation_checked(text,integer,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_event_operation_checked(text,integer,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_ob_day_entry(p_request_id uuid,p_event text,p_entry_id uuid,p_revision integer,p_name text,p_grade text,p_group integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ob_meet_entries%ROWTYPE; target public.ob_event_operations%ROWTYPE; previous public.ob_operation_changes%ROWTYPE;
 request jsonb; saved jsonb; result jsonb; persons jsonb; person jsonb; next_order integer; entry_uuid uuid; existing_group integer;
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
 SELECT * INTO target FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=p_event FOR UPDATE;
 IF coalesce((target.data->>'confirmed')::boolean,false) THEN RAISE EXCEPTION 'operation_confirmed'; END IF;
 IF p_group IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(target.data->'participants') p
   WHERE (p->>'group')::integer=p_group AND (p->>'status' IN ('DNF','DQ') OR EXISTS(
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
  SELECT n INTO next_order FROM generate_series(1,300) n WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(persons) p WHERE (p->>'group')::integer=p_group AND (p->>'order')::integer=n) ORDER BY n LIMIT 1;
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
 VALUES('ob-2026',p_event,auth.uid(),target.data,saved->'data',p_request_id,request,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.add_ob_day_entry(uuid,text,uuid,integer,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_ob_day_entry(uuid,text,uuid,integer,text,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';

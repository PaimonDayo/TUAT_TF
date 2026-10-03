-- Existing tables, history triggers and failover tracking remain the storage boundary.
CREATE OR REPLACE FUNCTION public.save_ob_registration_checked(
 p_entry_id uuid,p_profile_id uuid,p_revision integer,p_events text[],p_marks jsonb,
 p_party_id uuid,p_party_revision integer,p_party_status text,p_confirm_duties boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved uuid; conflicts jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_confirm_duties IS NULL THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 IF p_party_status IS NULL THEN
  IF p_party_id IS NOT NULL OR p_party_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  saved:=public.save_ob_entry(p_entry_id,p_profile_id,p_revision,p_events,p_marks);
 ELSE
  saved:=public.save_ob_registration(p_entry_id,p_profile_id,p_revision,p_events,p_marks,p_party_id,p_party_revision,p_party_status);
 END IF;
 -- save_ob_entry above checks staff/self access before any assignment details are returned.
 SELECT coalesce(jsonb_agg(jsonb_build_object('time',d.slot_time,'event',d.event_name,'assignment',d.assignment) ORDER BY d.slot_time,d.event_name),'[]') INTO conflicts
 FROM public.ob_meet_entries e JOIN (
  SELECT profile_id, NULL::uuid entry_id,slot_time,event_name,assignment,role_ids FROM public.ob_meet_duties WHERE meet_key='ob-2026'
  UNION ALL SELECT NULL::uuid,entry_id,slot_time,event_name,assignment,role_ids FROM public.ob_entry_duties WHERE meet_key='ob-2026'
 ) d ON d.profile_id=e.profile_id OR d.entry_id=e.id
 WHERE e.id=saved AND (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'') AND EXISTS(
  SELECT 1 FROM unnest(e.events) event JOIN public.ob_duty_event_slots s ON s.slot_time=d.slot_time
   AND s.event_name=CASE substring(event FROM 3) WHEN '立ち五段' THEN '立ち五段跳び' ELSE substring(event FROM 3) END);
 IF jsonb_array_length(conflicts)>0 AND NOT p_confirm_duties THEN
  RAISE EXCEPTION 'entry_duty_conflict' USING DETAIL=conflicts::text;
 END IF;
 RETURN jsonb_build_object('entryId',saved,'conflicts',conflicts);
END $$;
REVOKE ALL ON FUNCTION public.save_ob_registration_checked(uuid,uuid,integer,text[],jsonb,uuid,integer,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_registration_checked(uuid,uuid,integer,text[],jsonb,uuid,integer,text,boolean) TO authenticated;

-- A complete role membership change is one transaction; revisions include the whole event slot.
CREATE OR REPLACE FUNCTION public.save_ob_role_people(p_role_id uuid,p_revision integer,p_expected jsonb,p_people uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_column
DECLARE r public.ob_duty_roles%ROWTYPE; snapshot jsonb; assigned uuid[]; person uuid;
 e public.ob_meet_entries%ROWTYPE; d record; ids uuid[]; changed integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_revision IS NULL OR p_revision<0 OR p_expected IS NULL OR jsonb_typeof(p_expected)<>'array' OR jsonb_array_length(p_expected)>300
  OR p_people IS NULL OR cardinality(p_people)>300 OR array_position(p_people,NULL) IS NOT NULL
  OR cardinality(p_people)<>(SELECT count(DISTINCT x) FROM unnest(p_people) x)
 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT * INTO r FROM public.ob_duty_roles WHERE id=p_role_id AND meet_key='ob-2026' FOR UPDATE;
 IF NOT FOUND OR r.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 IF cardinality(p_people)>r.required_count THEN RAISE EXCEPTION 'role_full'; END IF;
 -- Prefer active entry storage, otherwise the last blank entry row, exactly as combineObDuties.
 WITH all_duties AS (
  SELECT m.profile_id person_id,m.revision,m.role_ids,m.assignment,false entry_storage FROM public.ob_meet_duties m
   WHERE m.meet_key='ob-2026' AND m.slot_time=r.slot_time AND m.event_name=r.event_name
  UNION ALL SELECT coalesce(e.profile_id,e.id),d.revision,d.role_ids,d.assignment,true FROM public.ob_entry_duties d
   JOIN public.ob_meet_entries e ON e.id=d.entry_id
   WHERE d.meet_key='ob-2026' AND d.slot_time=r.slot_time AND d.event_name=r.event_name
 ), picked AS (SELECT DISTINCT ON(person_id) * FROM all_duties ORDER BY person_id,(cardinality(role_ids)>0 OR btrim(assignment)<>'') DESC,entry_storage DESC)
 SELECT coalesce(jsonb_agg(jsonb_build_object('profileId',person_id,'revision',revision) ORDER BY person_id),'[]'),
  coalesce(array_agg(person_id) FILTER(WHERE r.id=ANY(role_ids)),'{}') INTO snapshot,assigned FROM picked;
 IF snapshot IS DISTINCT FROM (SELECT coalesce(jsonb_agg(value ORDER BY value->>'profileId'),'[]') FROM jsonb_array_elements(p_expected)) THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 IF EXISTS(SELECT 1 FROM public.ob_meet_duties m JOIN public.ob_entry_duties d ON d.meet_key=m.meet_key AND d.slot_time=m.slot_time AND d.event_name=m.event_name
  JOIN public.ob_meet_entries e ON e.id=d.entry_id AND e.profile_id=m.profile_id
  WHERE m.meet_key='ob-2026' AND m.slot_time=r.slot_time AND m.event_name=r.event_name
   AND (cardinality(m.role_ids)>0 OR btrim(m.assignment)<>'') AND (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'')) THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 -- Remove first for capacity; any later exception rolls these removals back as well.
 FOR person IN SELECT x FROM (
  SELECT x,0 phase FROM unnest(assigned) x WHERE NOT x=ANY(p_people)
  UNION ALL SELECT x,1 phase FROM unnest(p_people) x WHERE NOT x=ANY(assigned)
 ) changes ORDER BY phase,x
 LOOP
  SELECT * INTO e FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND (profile_id=person OR id=person) FOR UPDATE;
  SELECT profile_id,revision,role_ids,assignment INTO d FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=person AND slot_time=r.slot_time AND event_name=r.event_name;
  IF e.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ob_entry_duties WHERE entry_id=e.id AND slot_time=r.slot_time AND event_name=r.event_name
    AND (e.profile_id IS NULL OR cardinality(role_ids)>0 OR btrim(assignment)<>'' OR d.profile_id IS NULL OR (cardinality(d.role_ids)=0 AND btrim(d.assignment)=''))) THEN
   SELECT coalesce(e.profile_id,e.id) profile_id,revision,role_ids,assignment INTO d FROM public.ob_entry_duties WHERE entry_id=e.id AND slot_time=r.slot_time AND event_name=r.event_name;
  END IF;
  ids:=coalesce(d.role_ids,'{}');
  IF person=ANY(assigned) THEN ids:=array_remove(ids,r.id); ELSE ids:=array_append(ids,r.id); END IF;
  IF e.id IS NOT NULL THEN changed:=public.save_ob_entry_duty_roles(e.id,r.slot_time,r.event_name,ids,d.revision);
  ELSE changed:=public.save_ob_duty_roles(person,r.slot_time,r.event_name,ids,d.revision); END IF;
 END LOOP;
 RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_role_people(uuid,integer,jsonb,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_role_people(uuid,integer,jsonb,uuid[]) TO authenticated;
NOTIFY pgrst,'reload schema';

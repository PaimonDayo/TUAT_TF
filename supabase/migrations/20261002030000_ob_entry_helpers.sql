-- Unregistered participants use their meet entry, never a fabricated profile.
CREATE TABLE IF NOT EXISTS public.ob_entry_duties (
 meet_key text NOT NULL DEFAULT 'ob-2026' CHECK(meet_key='ob-2026'),
 entry_id uuid NOT NULL REFERENCES public.ob_meet_entries(id) ON DELETE CASCADE,
 slot_time text NOT NULL, event_name text NOT NULL,
 assignment text NOT NULL DEFAULT '' CHECK(length(assignment)<=200),
 role_ids uuid[] NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 PRIMARY KEY(meet_key,entry_id,slot_time,event_name),
 FOREIGN KEY(slot_time,event_name) REFERENCES public.ob_duty_event_slots
);
ALTER TABLE public.ob_entry_duties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_entry_duties FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ob_entry_duties TO authenticated;
GRANT ALL ON public.ob_entry_duties TO service_role;
DROP POLICY IF EXISTS ob_entry_duties_read ON public.ob_entry_duties;
CREATE POLICY ob_entry_duties_read ON public.ob_entry_duties FOR SELECT TO authenticated
 USING(public.can_manage_ob_meet() OR public.can_manage_system());

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
  IF EXISTS(SELECT 1 FROM unnest(e.events) event JOIN public.ob_duty_event_slots s
   ON s.slot_time=p_slot_time AND s.event_name=CASE substring(event FROM 3) WHEN '立ち五段' THEN '立ち五段跳び' ELSE substring(event FROM 3) END)
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

-- Old open tabs use the same checks and capacity total as the new entry-based form.
CREATE OR REPLACE FUNCTION public.save_ob_duty_roles(p_profile_id uuid,p_slot_time text,p_event_name text,p_role_ids uuid[],p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry_uuid uuid; rev integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT id INTO entry_uuid FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND profile_id=p_profile_id;
 IF entry_uuid IS NOT NULL THEN RETURN public.save_ob_entry_duty_roles(entry_uuid,p_slot_time,p_event_name,p_role_ids,p_revision); END IF;
 -- A removed entry must not strand an existing helper assignment.
 IF p_role_ids='{}'::uuid[] AND p_revision>=0 THEN
  UPDATE public.ob_meet_duties SET role_ids='{}',assignment='',revision=revision+1
   WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time AND event_name=p_event_name AND revision=p_revision RETURNING revision INTO rev;
  IF FOUND THEN RETURN rev; END IF;
 END IF;
 RAISE EXCEPTION 'entry_helper_ineligible';
END $$;

CREATE OR REPLACE FUNCTION public.save_ob_duty_role(p_id uuid,p_slot_time text,p_event_name text,p_name text,p_abbreviation text,p_required_count integer,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ob_duty_roles%ROWTYPE; used integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR p_abbreviation IS NULL OR length(btrim(p_abbreviation)) NOT BETWEEN 1 AND 8 OR p_required_count IS NULL OR p_required_count NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'entry_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/'||p_slot_time||'/'||p_event_name,0));
 IF p_id IS NULL THEN
  IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_conflict';END IF;
  INSERT INTO public.ob_duty_roles(slot_time,event_name,name,abbreviation,required_count) VALUES(p_slot_time,p_event_name,btrim(p_name),btrim(p_abbreviation),p_required_count) RETURNING id INTO p_id;
 ELSE
  SELECT * INTO r FROM public.ob_duty_roles WHERE id=p_id AND meet_key='ob-2026' AND slot_time=p_slot_time AND event_name=p_event_name FOR UPDATE;
  IF NOT FOUND OR p_revision IS NULL OR r.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict';END IF;
  SELECT (SELECT count(*) FROM public.ob_meet_duties WHERE p_id=ANY(role_ids))+(SELECT count(*) FROM public.ob_entry_duties WHERE p_id=ANY(role_ids)) INTO used;
  IF p_required_count<used THEN RAISE EXCEPTION 'role_below_assigned';END IF;
  UPDATE public.ob_duty_roles SET name=btrim(p_name),abbreviation=btrim(p_abbreviation),required_count=p_required_count,revision=revision+1 WHERE id=p_id;
 END IF;
 RETURN p_id;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'role_duplicate';
END $$;

-- Later identity confirmation preserves entry duties, and cannot hide a second assignment.
CREATE OR REPLACE FUNCTION public.guard_ob_entry_duty_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.is_mirror_write() THEN RETURN NEW; END IF;
 IF NEW.profile_id IS DISTINCT FROM OLD.profile_id AND NEW.profile_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.ob_entry_duties d JOIN public.ob_meet_duties m
   ON m.meet_key=d.meet_key AND m.profile_id=NEW.profile_id AND m.slot_time=d.slot_time
   WHERE d.entry_id=NEW.id AND (cardinality(d.role_ids)>0 OR btrim(d.assignment)<>'') AND (cardinality(m.role_ids)>0 OR btrim(m.assignment)<>''))
 THEN RAISE EXCEPTION 'entry_duty_link_conflict'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_ob_entry_duty_identity ON public.ob_meet_entries;
CREATE TRIGGER guard_ob_entry_duty_identity BEFORE UPDATE OF profile_id ON public.ob_meet_entries FOR EACH ROW EXECUTE FUNCTION public.guard_ob_entry_duty_identity();
REVOKE ALL ON FUNCTION public.guard_ob_entry_duty_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_ob_entry_duty_roles(uuid,text,text,uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_entry_duty_roles(uuid,text,text,uuid[],integer) TO authenticated;
REVOKE ALL ON FUNCTION public.save_ob_duty_roles(uuid,text,text,uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_duty_roles(uuid,text,text,uuid[],integer) TO authenticated;
REVOKE ALL ON FUNCTION public.save_ob_duty_role(uuid,text,text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_duty_role(uuid,text,text,text,text,integer,integer) TO authenticated;
DROP TRIGGER IF EXISTS zz_log_failover_change ON public.ob_entry_duties;
CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.ob_entry_duties FOR EACH ROW EXECUTE FUNCTION public.log_failover_change('meet_key','entry_id','slot_time','event_name');
NOTIFY pgrst,'reload schema';

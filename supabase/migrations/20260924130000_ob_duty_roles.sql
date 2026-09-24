CREATE TABLE public.ob_duty_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), meet_key text NOT NULL DEFAULT 'ob-2026',
 slot_time text NOT NULL,event_name text NOT NULL,name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 abbreviation text NOT NULL CHECK(length(btrim(abbreviation)) BETWEEN 1 AND 8),required_count integer NOT NULL CHECK(required_count BETWEEN 0 AND 99),revision integer NOT NULL DEFAULT 0,
 UNIQUE(meet_key,slot_time,event_name,name),FOREIGN KEY(slot_time,event_name) REFERENCES public.ob_duty_event_slots
);
ALTER TABLE public.ob_duty_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_duty_roles FROM anon,authenticated;
GRANT SELECT ON public.ob_duty_roles TO authenticated;
GRANT ALL ON public.ob_duty_roles TO service_role;
CREATE POLICY ob_duty_roles_system ON public.ob_duty_roles FOR SELECT TO authenticated USING(public.can_manage_system());
ALTER TABLE public.ob_meet_duties ADD COLUMN role_ids uuid[] NOT NULL DEFAULT '{}';
INSERT INTO public.ob_duty_roles(meet_key,slot_time,event_name,name,abbreviation,required_count)
 SELECT meet_key,slot_time,event_name,assignment,left(assignment,2),count(*) FROM public.ob_meet_duties WHERE btrim(assignment)<>'' GROUP BY meet_key,slot_time,event_name,assignment;
UPDATE public.ob_meet_duties d SET role_ids=ARRAY[r.id] FROM public.ob_duty_roles r WHERE r.meet_key=d.meet_key AND r.slot_time=d.slot_time AND r.event_name=d.event_name AND r.name=d.assignment;
CREATE FUNCTION public.save_ob_duty_role(p_id uuid,p_slot_time text,p_event_name text,p_name text,p_abbreviation text,p_required_count integer,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ob_duty_roles%ROWTYPE; used integer; BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR p_abbreviation IS NULL OR length(btrim(p_abbreviation)) NOT BETWEEN 1 AND 8 OR p_required_count IS NULL OR p_required_count NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'entry_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/'||p_slot_time||'/'||p_event_name,0));
 IF p_id IS NULL THEN
  IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_conflict';END IF;
  INSERT INTO public.ob_duty_roles(slot_time,event_name,name,abbreviation,required_count) VALUES(p_slot_time,p_event_name,btrim(p_name),btrim(p_abbreviation),p_required_count) RETURNING id INTO p_id;
 ELSE
  SELECT * INTO r FROM public.ob_duty_roles WHERE id=p_id AND meet_key='ob-2026' AND slot_time=p_slot_time AND event_name=p_event_name FOR UPDATE;
  IF NOT FOUND OR p_revision IS NULL OR r.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict';END IF;
  SELECT count(*) INTO used FROM public.ob_meet_duties WHERE p_id=ANY(role_ids);
  IF p_required_count<used THEN RAISE EXCEPTION 'role_below_assigned';END IF;
  UPDATE public.ob_duty_roles SET name=btrim(p_name),abbreviation=btrim(p_abbreviation),required_count=p_required_count,revision=revision+1 WHERE id=p_id;
 END IF;
 RETURN p_id;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'role_duplicate';
END $$;
CREATE FUNCTION public.save_ob_duty_roles(p_profile_id uuid,p_slot_time text,p_event_name text,p_role_ids uuid[],p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ob_duty_roles%ROWTYPE; used integer; label text; rev integer; BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';END IF;
 IF p_role_ids IS NULL OR cardinality(p_role_ids)>20 OR EXISTS(SELECT 1 FROM unnest(p_role_ids) x WHERE x IS NULL) OR cardinality(p_role_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_role_ids) x) THEN RAISE EXCEPTION 'entry_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/'||p_slot_time||'/'||p_event_name,0));
 IF cardinality(p_role_ids)<>(SELECT count(*) FROM public.ob_duty_roles WHERE id=ANY(p_role_ids) AND meet_key='ob-2026' AND slot_time=p_slot_time AND event_name=p_event_name) THEN RAISE EXCEPTION 'entry_invalid';END IF;
 FOR r IN SELECT * FROM public.ob_duty_roles WHERE id=ANY(p_role_ids) LOOP
  SELECT count(*) INTO used FROM public.ob_meet_duties WHERE r.id=ANY(role_ids) AND profile_id<>p_profile_id;
  IF used>=r.required_count THEN RAISE EXCEPTION 'role_full';END IF;
 END LOOP;
 -- The existing RPC remains responsible for active membership, competition conflicts and revisions.
 SELECT coalesce(string_agg(name,'・' ORDER BY name),'') INTO label FROM public.ob_duty_roles WHERE id=ANY(p_role_ids);
 IF length(label)>200 THEN RAISE EXCEPTION 'role_names_too_long';END IF;
 rev:=public.save_ob_duty(p_profile_id,p_slot_time,label,p_revision,p_event_name);
 UPDATE public.ob_meet_duties SET role_ids=p_role_ids,revision=CASE WHEN revision=p_revision AND role_ids IS DISTINCT FROM p_role_ids THEN revision+1 ELSE revision END WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time AND event_name=p_event_name;
 SELECT revision INTO rev FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time AND event_name=p_event_name;
 RETURN rev;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_duty_role(uuid,text,text,text,text,integer,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_ob_duty_roles(uuid,text,text,uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_duty_role(uuid,text,text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_ob_duty_roles(uuid,text,text,uuid[],integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.save_ob_duty(uuid,text,text,integer,text) FROM authenticated;
NOTIFY pgrst,'reload schema';

-- Program/duties are shared with approved members; management/history stays restricted.
CREATE OR REPLACE FUNCTION public.can_view_ob_program() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved AND status='active')
$$;
REVOKE ALL ON FUNCTION public.can_view_ob_program() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_ob_program() TO authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ob_meet_entries','ob_meet_duties','ob_entry_duties','ob_duty_roles','ob_event_operations'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS ob_program_member_read ON public.%I',t);
  EXECUTE format('CREATE POLICY ob_program_member_read ON public.%I FOR SELECT TO authenticated USING (meet_key=''ob-2026'' AND public.can_view_ob_program())',t);
 END LOOP;
END $$;

-- Reuse the existing validation, division guard, audit and party transaction.
CREATE OR REPLACE FUNCTION public.create_ob_guest_registration(p_name text,p_grade text,p_events text[],p_marks jsonb,p_party_status text,p_party_id uuid DEFAULT NULL,p_party_revision integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry_uuid uuid; name_key text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 name_key:=regexp_replace(normalize(p_name,NFKC),'[[:space:]　]','','g');
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR name_key='' OR p_grade IS NULL
   OR p_grade NOT IN ('B1','B2','B3','B4','M1','M2','D1','D2','D3','OB・OG')
   OR p_party_status IS NULL OR p_party_status NOT IN ('参加','不参加','未回答')
   OR p_events IS NULL OR (cardinality(p_events)=0 AND p_party_status='未回答') THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/name/'||name_key,0));
 IF EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND regexp_replace(normalize(submitted_name,NFKC),'[[:space:]　]','','g')=name_key)
 OR EXISTS(SELECT 1 FROM public.ob_party_responses WHERE meet_key='ob-2026' AND regexp_replace(normalize(submitted_name,NFKC),'[[:space:]　]','','g')=name_key AND id IS DISTINCT FROM p_party_id)
 THEN RAISE EXCEPTION 'entry_duplicate' USING ERRCODE='23505'; END IF;
 INSERT INTO public.ob_meet_entries(meet_key,submitted_name,grade,events,qualification_marks)
 VALUES('ob-2026',btrim(p_name),p_grade,'{}','{}') RETURNING id INTO entry_uuid;
 RETURN public.save_ob_registration(entry_uuid,NULL,0,p_events,p_marks,p_party_id,p_party_revision,p_party_status);
END $$;
REVOKE ALL ON FUNCTION public.create_ob_guest_registration(text,text,text[],jsonb,text,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_ob_guest_registration(text,text,text[],jsonb,text,uuid,integer) TO authenticated;

-- Keep historical snapshots after removing their parent, including fallback replay.
ALTER TABLE public.ob_entry_changes DROP CONSTRAINT IF EXISTS ob_entry_changes_entry_id_fkey;
ALTER TABLE public.ob_entry_changes ADD CONSTRAINT ob_entry_changes_entry_id_fkey
 FOREIGN KEY(entry_id) REFERENCES public.ob_meet_entries(id) ON DELETE SET NULL;

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
   WHERE o.meet_key='ob-2026' AND p->>'entryId'=e.id::text)
 THEN RAISE EXCEPTION 'entry_has_operations'; END IF;
 -- Preserve party response and its audit; deleting a race entry does not cancel dinner.
 UPDATE public.ob_party_responses SET entry_id=NULL,revision=revision+1 WHERE entry_id=e.id;
 INSERT INTO public.ob_entry_changes(entry_id,actor_id,before_data,after_data)
 VALUES(NULL,auth.uid(),to_jsonb(e),to_jsonb(e)||jsonb_build_object('change_type','entry_deleted'));
 DELETE FROM public.ob_meet_entries WHERE id=e.id;
 RETURN e.id;
END $$;
REVOKE ALL ON FUNCTION public.delete_ob_registration(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_ob_registration(uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';

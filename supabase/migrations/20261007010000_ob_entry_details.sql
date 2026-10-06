-- Participant details belong to the existing entry UUID. Preserve imported
-- answers, profile links, division, duties and every saved performance.
-- No backfill or new table: existing audit/failover triggers cover the update.
CREATE OR REPLACE FUNCTION public.get_ob_registration_details_snapshot(p_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN
  RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';
 END IF;
 IF p_entry_id IS NULL THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 -- One statement observes the entry and its linked party answer together.
 SELECT jsonb_build_object(
  'entry',jsonb_build_object('id',e.id,'revision',e.revision,'submitted_name',e.submitted_name,
   'grade',e.grade,'events',e.events,'qualification_marks',e.qualification_marks),
  'party',CASE WHEN p.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object(
   'id',p.id,'revision',p.revision,'status',p.status,'entry_id',p.entry_id) END)
 INTO snapshot FROM public.ob_meet_entries e
 LEFT JOIN public.ob_party_responses p ON p.entry_id=e.id AND p.meet_key=e.meet_key
 WHERE e.id=p_entry_id AND e.meet_key='ob-2026';
 IF NOT FOUND THEN RAISE EXCEPTION 'entry_missing'; END IF;
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.get_ob_registration_details_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_ob_registration_details_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_ob_registration_details_checked(
 p_entry_id uuid,p_profile_id uuid,p_revision integer,p_events text[],p_marks jsonb,
 p_party_id uuid,p_party_revision integer,p_party_status text,p_confirm_duties boolean,
 p_name text,p_grade text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_meet_entries%ROWTYPE; party public.ob_party_responses%ROWTYPE;
 name_key text; registration_unchanged boolean; party_unchanged boolean; saved jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN
  RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';
 END IF;
 name_key:=regexp_replace(normalize(p_name,NFKC),'[[:space:]　]','','g');
 IF p_entry_id IS NULL OR p_profile_id IS NOT NULL OR p_revision IS NULL OR p_revision<0
  OR p_confirm_duties IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100
  OR name_key='' OR p_grade IS NULL OR p_grade NOT IN ('B1','B2','B3','B4','M1','M2','D1','D2','D3','OB・OG')
 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 p_name:=btrim(p_name);
 -- Match guest creation's name-before-roster lock order.
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/name/'||name_key,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 SELECT * INTO target FROM public.ob_meet_entries WHERE id=p_entry_id AND meet_key='ob-2026' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'entry_missing'; END IF;
 IF target.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 IF regexp_replace(normalize(target.submitted_name,NFKC),'[[:space:]　]','','g') IS DISTINCT FROM name_key
  AND (EXISTS(SELECT 1 FROM public.ob_meet_entries e WHERE e.meet_key='ob-2026' AND e.id<>target.id
   AND regexp_replace(normalize(e.submitted_name,NFKC),'[[:space:]　]','','g')=name_key)
   OR EXISTS(SELECT 1 FROM public.ob_party_responses p WHERE p.meet_key='ob-2026' AND NOT p.needs_review
    AND p.entry_id IS DISTINCT FROM target.id AND p.id IS DISTINCT FROM p_party_id
    AND regexp_replace(normalize(p.submitted_name,NFKC),'[[:space:]　]','','g')=name_key))
 THEN RAISE EXCEPTION 'entry_duplicate' USING ERRCODE='23505'; END IF;
 SELECT * INTO party FROM public.ob_party_responses WHERE entry_id=target.id AND meet_key='ob-2026' FOR UPDATE;
 registration_unchanged:=target.events IS NOT DISTINCT FROM p_events
  AND target.qualification_marks IS NOT DISTINCT FROM p_marks;
 party_unchanged:=(p_party_status IS NULL AND p_party_id IS NULL AND p_party_revision IS NULL)
  OR (party.id IS NOT NULL AND p_party_id=party.id AND p_party_revision=party.revision
   AND p_party_status=party.status AND NOT party.needs_review)
  OR (party.id IS NULL AND p_party_id IS NULL AND p_party_revision IS NULL AND p_party_status='未回答');
 IF registration_unchanged AND coalesce(party_unchanged,false) THEN
  -- Correcting a name/grade does not introduce an event/duty conflict or create
  -- an unanswered party row. Provided party revisions still must match above.
  saved:=jsonb_build_object('entryId',target.id,'conflicts','[]'::jsonb);
 ELSE
  saved:=public.save_ob_registration_checked(p_entry_id,p_profile_id,p_revision,p_events,p_marks,
   p_party_id,p_party_revision,p_party_status,p_confirm_duties);
 END IF;
 IF target.submitted_name IS DISTINCT FROM p_name OR target.grade IS DISTINCT FROM p_grade THEN
  UPDATE public.ob_meet_entries SET submitted_name=p_name,grade=p_grade,
   revision=greatest(revision,target.revision+1) WHERE id=target.id;
 END IF;
 -- Party names/group labels are separate imported answers (including graduate
 -- years); do not replace them with the competition entry's current grade.
 RETURN public.get_ob_registration_details_snapshot(target.id)||saved;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_registration_details_checked(uuid,uuid,integer,text[],jsonb,uuid,integer,text,boolean,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_registration_details_checked(uuid,uuid,integer,text[],jsonb,uuid,integer,text,boolean,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';

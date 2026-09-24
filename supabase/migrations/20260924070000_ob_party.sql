CREATE TABLE IF NOT EXISTS public.ob_party_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_key text NOT NULL DEFAULT 'ob-2026',
  submitted_name text NOT NULL,
  group_label text NOT NULL,
  status text NOT NULL CHECK(status IN ('参加','不参加','未回答')),
  entry_id uuid UNIQUE REFERENCES public.ob_meet_entries(id),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  needs_review boolean NOT NULL DEFAULT false,
  source_key text UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS ob_party_name_unique ON public.ob_party_responses
 (meet_key,regexp_replace(normalize(submitted_name,NFKC),'[[:space:]　]','','g')) WHERE NOT needs_review;
ALTER TABLE public.ob_party_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_party_responses FROM anon,authenticated;
GRANT SELECT ON public.ob_party_responses TO authenticated;
GRANT ALL ON public.ob_party_responses TO service_role;
DROP POLICY IF EXISTS ob_party_system_read ON public.ob_party_responses;
CREATE POLICY ob_party_system_read ON public.ob_party_responses FOR SELECT TO authenticated USING(public.can_manage_system());

CREATE OR REPLACE FUNCTION public.save_ob_party(p_id uuid,p_revision integer,p_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_party_responses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('参加','不参加','未回答') OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  SELECT * INTO target FROM public.ob_party_responses WHERE id=p_id AND meet_key='ob-2026' FOR UPDATE;
  IF NOT FOUND OR target.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
  IF target.needs_review THEN RAISE EXCEPTION 'party_identity_required'; END IF;
  IF target.status<>p_status THEN UPDATE public.ob_party_responses SET status=p_status,revision=revision+1 WHERE id=target.id; END IF;
  RETURN target.id;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_party(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_party(uuid,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_ob_entry(p_entry_id uuid, p_profile_id uuid, p_revision integer, p_events text[], p_marks jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  target public.ob_meet_entries%ROWTYPE;
  member public.profiles%ROWTYPE;
  allowed text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  SELECT array_agg(g.prefix || e.event) INTO allowed
  FROM (VALUES ('男子'),('女子')) g(prefix)
  CROSS JOIN (VALUES ('100m'),('300m'),('300mH'),('1500m'),('3000m'),('走り幅跳び'),('走り高跳び'),('立ち五段'),('砲丸投げ'),('やり投げ'),('ジャベリックスロー')) e(event);
  IF p_events IS NULL OR cardinality(p_events)>22 OR array_position(p_events,NULL) IS NOT NULL
    OR NOT p_events <@ allowed OR cardinality(p_events)<>(SELECT count(DISTINCT x) FROM unnest(p_events) x)
    OR p_marks IS NULL OR jsonb_typeof(p_marks)<>'object' THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_marks) m WHERE NOT m.key=ANY(p_events)
    OR jsonb_typeof(m.value) NOT IN ('null','string') OR length(m.value #>> '{}')>1000) THEN RAISE EXCEPTION 'entry_invalid'; END IF;
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
REVOKE ALL ON FUNCTION public.save_ob_entry(uuid,uuid,integer,text[],jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_ob_entry(uuid,uuid,integer,text[],jsonb) TO authenticated;

-- Competition and party edits commit together or not at all.
CREATE OR REPLACE FUNCTION public.save_ob_registration(p_entry_id uuid,p_profile_id uuid,p_revision integer,p_events text[],p_marks jsonb,p_party_id uuid,p_party_revision integer,p_party_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry_uuid uuid; e public.ob_meet_entries%ROWTYPE; p public.ob_party_responses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  IF p_party_status IS NULL OR p_party_status NOT IN ('参加','不参加','未回答') THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  IF p_entry_id IS NULL AND cardinality(p_events)=0 AND p_party_status='未回答' THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  entry_uuid:=public.save_ob_entry(p_entry_id,p_profile_id,p_revision,p_events,p_marks);
  SELECT * INTO e FROM public.ob_meet_entries WHERE id=entry_uuid;
  IF p_party_id IS NULL THEN
    IF p_party_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_invalid'; END IF;
    INSERT INTO public.ob_party_responses(submitted_name,group_label,status,entry_id)
      VALUES(e.submitted_name,e.grade,p_party_status,entry_uuid);
  ELSE
    SELECT * INTO p FROM public.ob_party_responses WHERE id=p_party_id AND meet_key='ob-2026' FOR UPDATE;
    IF NOT FOUND OR p_party_revision IS NULL OR p.revision<>p_party_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
    IF p.needs_review OR (p.entry_id IS NOT NULL AND p.entry_id<>entry_uuid) THEN RAISE EXCEPTION 'party_identity_required'; END IF;
    -- Unlinked party-only answers need an explicit, matching member selection.
    IF p.entry_id IS NULL AND regexp_replace(normalize(p.submitted_name,NFKC),'[[:space:]　]','','g')<>regexp_replace(normalize(e.submitted_name,NFKC),'[[:space:]　]','','g') THEN RAISE EXCEPTION 'party_identity_required'; END IF;
    IF p.entry_id IS DISTINCT FROM entry_uuid OR p.status<>p_party_status THEN
      UPDATE public.ob_party_responses SET status=p_party_status,entry_id=entry_uuid,revision=revision+1 WHERE id=p.id;
    END IF;
  END IF;
  RETURN entry_uuid;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_registration(uuid,uuid,integer,text[],jsonb,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_registration(uuid,uuid,integer,text[],jsonb,uuid,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';

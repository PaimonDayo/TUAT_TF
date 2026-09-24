CREATE TABLE public.ob_entry_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.ob_meet_entries(id),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  before_data jsonb,
  after_data jsonb NOT NULL
);
CREATE INDEX ob_entry_changes_entry_time ON public.ob_entry_changes(entry_id, changed_at DESC);
ALTER TABLE public.ob_entry_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_entry_changes FROM anon, authenticated;
GRANT SELECT ON public.ob_entry_changes TO authenticated;
CREATE POLICY ob_entry_changes_system_read ON public.ob_entry_changes FOR SELECT TO authenticated USING (public.can_manage_system());

CREATE FUNCTION public.log_ob_entry_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  INSERT INTO public.ob_entry_changes(entry_id, actor_id, before_data, after_data)
  VALUES(NEW.id, auth.uid(), CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_ob_entry_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ob_entry_change_log AFTER INSERT OR UPDATE ON public.ob_meet_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_ob_entry_change();

CREATE FUNCTION public.save_ob_entry(p_entry_id uuid, p_profile_id uuid, p_revision integer, p_events text[], p_marks jsonb)
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
    IF p_profile_id IS NULL OR p_revision IS NOT NULL OR cardinality(p_events)=0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
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
NOTIFY pgrst, 'reload schema';

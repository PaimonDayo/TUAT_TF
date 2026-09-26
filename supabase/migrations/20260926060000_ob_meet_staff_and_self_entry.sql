-- OB戦: 「OB戦2026」ロールの人をシステムロールと同じ係として扱い、一般部員は自分のエントリーだけ登録・編集できるようにする。
-- 冪等（CREATE OR REPLACE / DROP POLICY IF EXISTS / ロールは無いときだけ作成）。

INSERT INTO public.roles (name)
SELECT 'OB戦2026' WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name='OB戦2026');

CREATE OR REPLACE FUNCTION public.can_manage_ob_meet() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND (public.can_manage_system() OR EXISTS(
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=auth.uid() AND r.name='OB戦2026'))
$$;
REVOKE ALL ON FUNCTION public.can_manage_ob_meet() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_ob_meet() TO authenticated;

DROP POLICY IF EXISTS ob_meet_entries_system_read ON public.ob_meet_entries;
CREATE POLICY ob_meet_entries_system_read ON public.ob_meet_entries
  FOR SELECT TO authenticated USING (public.can_manage_ob_meet() OR profile_id=auth.uid());
DROP POLICY IF EXISTS ob_meet_entries_system_update ON public.ob_meet_entries;
CREATE POLICY ob_meet_entries_system_update ON public.ob_meet_entries
  FOR UPDATE TO authenticated USING (public.can_manage_ob_meet()) WITH CHECK (public.can_manage_ob_meet());
DROP POLICY IF EXISTS ob_entry_changes_system_read ON public.ob_entry_changes;
CREATE POLICY ob_entry_changes_system_read ON public.ob_entry_changes FOR SELECT TO authenticated USING (public.can_manage_ob_meet());
DROP POLICY IF EXISTS ob_party_system_read ON public.ob_party_responses;
CREATE POLICY ob_party_system_read ON public.ob_party_responses FOR SELECT TO authenticated
  USING (public.can_manage_ob_meet() OR entry_id IN (SELECT e.id FROM public.ob_meet_entries e WHERE e.profile_id=auth.uid()));
DROP POLICY IF EXISTS ob_duties_system_read ON public.ob_meet_duties;
CREATE POLICY ob_duties_system_read ON public.ob_meet_duties FOR SELECT TO authenticated USING (public.can_manage_ob_meet());
DROP POLICY IF EXISTS ob_duty_roles_system ON public.ob_duty_roles;
CREATE POLICY ob_duty_roles_system ON public.ob_duty_roles FOR SELECT TO authenticated USING (public.can_manage_ob_meet());

CREATE OR REPLACE FUNCTION public.save_ob_party(p_id uuid,p_revision integer,p_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_party_responses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('参加','不参加','未回答') OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  SELECT * INTO target FROM public.ob_party_responses WHERE id=p_id AND meet_key='ob-2026' FOR UPDATE;
  IF NOT FOUND OR target.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
  IF target.needs_review THEN RAISE EXCEPTION 'party_identity_required'; END IF;
  IF target.status<>p_status THEN UPDATE public.ob_party_responses SET status=p_status,revision=revision+1 WHERE id=target.id; END IF;
  RETURN target.id;
END $$;

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

CREATE OR REPLACE FUNCTION public.save_ob_registration(p_entry_id uuid,p_profile_id uuid,p_revision integer,p_events text[],p_marks jsonb,p_party_id uuid,p_party_revision integer,p_party_status text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry_uuid uuid; e public.ob_meet_entries%ROWTYPE; p public.ob_party_responses%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  -- 本人かどうかの確認は save_ob_entry が行う。
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

CREATE OR REPLACE FUNCTION public.save_ob_duty_role(p_id uuid,p_slot_time text,p_event_name text,p_name text,p_abbreviation text,p_required_count integer,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ob_duty_roles%ROWTYPE; used integer; BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';END IF;
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

CREATE OR REPLACE FUNCTION public.save_ob_duty_roles(p_profile_id uuid,p_slot_time text,p_event_name text,p_role_ids uuid[],p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ob_duty_roles%ROWTYPE; used integer; label text; rev integer; BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501';END IF;
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

-- 紐付け前の回答（Googleフォーム）を、本人が自分のものとして呼び出す。照合はアプリの名前で行う。
-- 取り違え防止: 未紐付け・現役・アプリの名前（空白と全半角を無視）と学年が一致する回答が1件だけのときに限る。係はあとから本人照合で直せる。
CREATE OR REPLACE FUNCTION public.claim_ob_entry()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE member public.profiles%ROWTYPE; hits uuid[]; key text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO member FROM public.profiles WHERE id=auth.uid() AND approved AND status='active';
  IF NOT FOUND OR member.grade IS NULL THEN RAISE EXCEPTION 'entry_member_missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND profile_id=auth.uid()) THEN RAISE EXCEPTION 'entry_duplicate' USING ERRCODE='23505'; END IF;
  key:=regexp_replace(normalize(member.display_name,NFKC),'[[:space:]　]','','g');
  SELECT array_agg(id) INTO hits FROM public.ob_meet_entries
   WHERE meet_key='ob-2026' AND profile_id IS NULL AND grade<>'OB・OG'
     AND regexp_replace(normalize(submitted_name,NFKC),'[[:space:]　]','','g')=key
     AND grade=CASE WHEN member.grade IN ('1','2','3','4') THEN 'B'||member.grade ELSE member.grade END;
  IF hits IS NULL THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF cardinality(hits)>1 THEN RAISE EXCEPTION 'claim_ambiguous'; END IF;
  UPDATE public.ob_meet_entries SET profile_id=auth.uid(),revision=revision+1 WHERE id=hits[1] AND profile_id IS NULL;
  RETURN hits[1];
END $$;
REVOKE ALL ON FUNCTION public.claim_ob_entry() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_ob_entry() TO authenticated;

NOTIFY pgrst,'reload schema';

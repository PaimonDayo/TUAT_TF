-- Participant identity and each appearance have independent, permanent IDs.
-- The old OB tables remain an immutable migration source, including audit trails.
CREATE TABLE IF NOT EXISTS public.competition_meets (
 competition_id text PRIMARY KEY REFERENCES public.competitions(id) ON DELETE RESTRICT,
 meet_key text NOT NULL UNIQUE, staff_role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
 legacy_source text, ready boolean NOT NULL DEFAULT false, source_frozen boolean NOT NULL DEFAULT false, program jsonb NOT NULL DEFAULT '[]', party_info jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.competition_meet_events (
 competition_id text NOT NULL REFERENCES public.competition_meets(competition_id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100), family text NOT NULL,
 division text NOT NULL CHECK(division IN ('男子','女子','混合')), starts_at text,
 sort_order integer NOT NULL DEFAULT 0, discipline text NOT NULL CHECK(discipline IN ('track','distance','height')),
 wind boolean NOT NULL DEFAULT false, capacity integer CHECK(capacity BETWEEN 1 AND 99),
 confirmed boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0,
 PRIMARY KEY(competition_id,name)
);
CREATE TABLE IF NOT EXISTS public.competition_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id text NOT NULL REFERENCES public.competition_meets(competition_id) ON DELETE RESTRICT,
 profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100), grade text NOT NULL,
 absent boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0, legacy_data jsonb, UNIQUE(competition_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS competition_participant_profile ON public.competition_participants(competition_id,profile_id) WHERE profile_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.competition_appearances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id text NOT NULL,
 participant_id uuid NOT NULL REFERENCES public.competition_participants(id) ON DELETE RESTRICT,
 event_name text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0), operation_key text NOT NULL,
 qualification_mark text, state text NOT NULL DEFAULT 'registered' CHECK(state IN ('registered','cancelled','deleted')),
 performance jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
 FOREIGN KEY(competition_id,event_name) REFERENCES public.competition_meet_events(competition_id,name) ON DELETE RESTRICT,
 FOREIGN KEY(competition_id,participant_id) REFERENCES public.competition_participants(competition_id,id) ON DELETE RESTRICT,
 UNIQUE(competition_id,event_name,operation_key), UNIQUE(participant_id,event_name,ordinal)
);
CREATE INDEX IF NOT EXISTS competition_appearance_participant ON public.competition_appearances(participant_id);
CREATE TABLE IF NOT EXISTS public.competition_meet_duty_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id text NOT NULL REFERENCES public.competition_meets(competition_id) ON DELETE RESTRICT,
 slot_time text NOT NULL, event_name text NOT NULL, name text NOT NULL,
 required_count integer NOT NULL CHECK(required_count>=0), revision integer NOT NULL DEFAULT 0, abbreviation text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS public.competition_meet_duties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id text NOT NULL REFERENCES public.competition_meets(competition_id) ON DELETE RESTRICT,
 participant_id uuid NOT NULL REFERENCES public.competition_participants(id) ON DELETE RESTRICT,
 slot_time text NOT NULL, event_name text NOT NULL, assignment text NOT NULL DEFAULT '',
 role_ids uuid[] NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 0, source text NOT NULL DEFAULT 'app',
 FOREIGN KEY(competition_id,participant_id) REFERENCES public.competition_participants(competition_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.competition_meet_party (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), competition_id text NOT NULL REFERENCES public.competition_meets(competition_id) ON DELETE RESTRICT,
 participant_id uuid REFERENCES public.competition_participants(id) ON DELETE RESTRICT,
 name text NOT NULL, group_label text NOT NULL, status text NOT NULL CHECK(status IN ('参加','不参加','未回答')),
 needs_review boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 0,
 FOREIGN KEY(competition_id,participant_id) REFERENCES public.competition_participants(competition_id,id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.competition_meet_requests (
 id uuid PRIMARY KEY, competition_id text NOT NULL REFERENCES public.competition_meets(competition_id) ON DELETE RESTRICT,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL, actor_name text,
 command jsonb NOT NULL, result jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
 before_data jsonb, after_data jsonb
);

CREATE OR REPLACE FUNCTION public.competition_meet_permissions(p_competition_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH flags AS (SELECT
  EXISTS(SELECT 1 FROM public.competition_meets m JOIN public.roles r ON r.id=m.staff_role_id WHERE m.competition_id=p_competition_id AND (r.is_everyone OR EXISTS(SELECT 1 FROM public.profile_roles pr WHERE pr.role_id=r.id AND pr.profile_id=auth.uid()))) staff,
  public.can_manage_system() system,
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved) registrant,
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved AND status='active') member,
  EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=p_competition_id AND legacy_source='ob-2026') legacy)
  SELECT jsonb_build_object('manage',registrant AND (staff OR (system AND NOT legacy)),'groups',registrant AND (staff OR system),'record',registrant AND (staff OR system OR member),'register',registrant,'configure',registrant AND system,'history',registrant AND (staff OR system OR public.can_manage_members())) FROM flags
$$;
REVOKE ALL ON FUNCTION public.competition_meet_permissions(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.competition_meet_permissions(text) TO authenticated;

-- Read-only RLS; mutations go through one checked, atomic RPC.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['competition_meets','competition_meet_events','competition_participants','competition_appearances','competition_meet_duty_roles','competition_meet_duties','competition_meet_party','competition_meet_requests'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('DROP POLICY IF EXISTS meet_read ON public.%I',t);
  IF t='competition_meet_party' THEN
   EXECUTE format('CREATE POLICY meet_read ON public.%I FOR SELECT TO authenticated USING ((public.competition_meet_permissions(competition_id)->>''manage'')::boolean OR EXISTS(SELECT 1 FROM public.competition_participants p WHERE p.id=participant_id AND p.profile_id=auth.uid()))',t);
  ELSIF t='competition_meet_requests' THEN
   EXECUTE format('CREATE POLICY meet_read ON public.%I FOR SELECT TO authenticated USING (actor_id=auth.uid() OR (public.competition_meet_permissions(competition_id)->>''manage'')::boolean)',t);
  ELSE
   EXECUTE format('CREATE POLICY meet_read ON public.%I FOR SELECT TO authenticated USING ((public.competition_meet_permissions(competition_id)->>''record'')::boolean OR EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved))',t);
  END IF;
 END LOOP;
END $$;
-- Legacy contact fields and raw audit snapshots are never granted to general members.
REVOKE SELECT ON public.competition_participants FROM authenticated;
GRANT SELECT(id,competition_id,profile_id,name,grade,absent,deleted,revision) ON public.competition_participants TO authenticated;
REVOKE SELECT ON public.competition_meet_requests FROM authenticated;

CREATE OR REPLACE FUNCTION public.competition_meet_source_digest() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(jsonb_build_object('ob_meet_entries',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_meet_entries row),'ob_event_operations',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_event_operations row),'ob_meet_duties',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_meet_duties row),'ob_entry_duties',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_entry_duties row),'ob_duty_roles',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_duty_roles row),'ob_party_responses',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_party_responses row),'ob_entry_changes',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_entry_changes row),'ob_operation_changes',(SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb) FROM public.ob_operation_changes row),'helperProfiles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'grade',p.grade) ORDER BY p.id),'[]'::jsonb) FROM public.profiles p WHERE EXISTS(SELECT 1 FROM public.ob_meet_duties d WHERE d.profile_id=p.id)),'staffRole',(SELECT id FROM public.roles WHERE name='OB戦2026' LIMIT 1))::text)
$$;
REVOKE ALL ON FUNCTION public.competition_meet_source_digest() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.competition_meet_source_digest() TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_competition_meet_import(p_activate boolean,p_expected_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE competition text:='3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5'; headers text; claims text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||competition,0));
 IF EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=competition AND ready) THEN RETURN jsonb_build_object('alreadyReady',true); END IF;
 LOCK TABLE public.ob_meet_entries,public.ob_event_operations,public.ob_meet_duties,public.ob_entry_duties,public.ob_duty_roles,public.ob_party_responses,public.ob_entry_changes,public.ob_operation_changes IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE public.profiles,public.roles IN SHARE MODE;
 IF p_activate AND (p_expected_digest IS NULL OR public.competition_meet_source_digest() IS DISTINCT FROM p_expected_digest) THEN RAISE EXCEPTION 'meet_source_changed'; END IF;
 IF p_activate AND NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=competition AND source_frozen) THEN RAISE EXCEPTION 'meet_source_not_frozen'; END IF;
 IF p_activate AND EXISTS(SELECT 1 FROM public.failover_changes WHERE table_name IN ('ob_meet_entries','ob_event_operations','ob_meet_duties','ob_entry_duties','ob_duty_roles','ob_party_responses','ob_entry_changes','ob_operation_changes')) THEN RAISE EXCEPTION 'meet_pending_replay'; END IF;
 IF EXISTS(SELECT 1 FROM public.competition_meet_requests WHERE competition_id=competition) THEN RAISE EXCEPTION 'meet_import_has_requests'; END IF;
 headers:=current_setting('request.headers',true);claims:=current_setting('request.jwt.claims',true);
 -- Bootstrap rows are a copy of the source, not new failover writes.
 PERFORM set_config('request.headers','{"x-tuat-mirror":"1"}',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 DELETE FROM public.competition_meet_party WHERE competition_id=competition;
 DELETE FROM public.competition_meet_duties WHERE competition_id=competition;
 DELETE FROM public.competition_meet_duty_roles WHERE competition_id=competition;
 DELETE FROM public.competition_appearances WHERE competition_id=competition;
 DELETE FROM public.competition_participants WHERE competition_id=competition;
 DELETE FROM public.competition_meet_events WHERE competition_id=competition;
-- Idempotent import: existing canonical changes are never overwritten on a second run.
INSERT INTO public.competition_meets(competition_id,meet_key,staff_role_id,legacy_source)
SELECT c.id,'ob-2026',(SELECT id FROM public.roles WHERE name='OB戦2026' LIMIT 1),'ob-2026'
FROM public.competitions c WHERE c.id='3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5' ON CONFLICT DO NOTHING;
UPDATE public.competition_meets SET program='[{"time":"09:00","label":"受付開始","events":[]},{"time":"09:30","label":"開会式","events":[]},{"time":"10:00","label":"1500m","events":["1500m"]},{"time":"10:30","label":"ジャベリックスロー・立ち五段跳び","events":["ジャベリックスロー","立ち五段"]},{"time":"11:00","label":"100m・砲丸投げ","events":["100m","砲丸投げ"]},{"time":"11:40","label":"300mH","events":["300mH"]},{"time":"12:20","label":"OB・OG総会","events":[]},{"time":"13:00","label":"走り高跳び","events":["走り高跳び"]},{"time":"13:30","label":"300m","events":["300m"]},{"time":"14:30","label":"やり投げ・走り幅跳び","events":["やり投げ","走り幅跳び"]},{"time":"15:00","label":"3000m","events":["3000m"]},{"time":"15:30","label":"4×300mリレー","events":[],"note":"当日エントリー"},{"time":"16:00","label":"閉会式","events":[]}]',party_info='{"time":"19:00〜","venue":"ミライザカ 府中並木通り店","fee":3500}' WHERE legacy_source='ob-2026' AND NOT ready AND program='[]'::jsonb;
INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,sort_order,discipline,wind,capacity)
SELECT m.competition_id,division||family,family,division,starts_at,n,
 CASE WHEN family IN ('100m','300m','300mH','1500m','3000m') THEN 'track' WHEN family='走り高跳び' THEN 'height' ELSE 'distance' END,
 family IN ('100m','走り幅跳び'),CASE WHEN family='100m' THEN 8 WHEN family IN ('300m','300mH') THEN 6 ELSE NULL END
FROM public.competition_meets m CROSS JOIN (VALUES
 ('1500m','10:00',1),('ジャベリックスロー','10:30',2),('立ち五段','10:30',3),('100m','11:00',4),('砲丸投げ','11:00',5),('300mH','11:40',6),('走り高跳び','13:00',7),('300m','13:30',8),('やり投げ','14:30',9),('走り幅跳び','14:30',10),('3000m','15:00',11)) slots(family,starts_at,n)
CROSS JOIN (VALUES('男子'),('女子')) divisions(division) WHERE m.legacy_source='ob-2026' AND NOT m.ready ON CONFLICT DO NOTHING;
INSERT INTO public.competition_participants(id,competition_id,profile_id,name,grade,absent,revision,legacy_data)
SELECT e.id,m.competition_id,e.profile_id,e.submitted_name,e.grade,e.absent,e.revision,to_jsonb(e)
FROM public.ob_meet_entries e JOIN public.competition_meets m ON m.legacy_source=e.meet_key AND NOT m.ready ON CONFLICT DO NOTHING;
-- Preserve orphaned saved results, even if their former registration was removed.
INSERT INTO public.competition_participants(id,competition_id,name,grade,deleted,legacy_data)
SELECT DISTINCT split_part(person->>'entryId',':',1)::uuid,m.competition_id,
 coalesce(history.data->>'submitted_name','登録解除済み'),coalesce(history.data->>'grade','不明'),true,history.data
FROM public.ob_event_operations o JOIN public.competition_meets m ON m.legacy_source=o.meet_key AND NOT m.ready
CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') person
LEFT JOIN LATERAL (SELECT coalesce(h.before_data,h.after_data) data FROM public.ob_entry_changes h
 WHERE coalesce(h.before_data->>'id',h.after_data->>'id')=split_part(person->>'entryId',':',1) ORDER BY h.changed_at DESC,h.id DESC LIMIT 1) history ON true
ON CONFLICT DO NOTHING;
-- Helpers without a race registration are participants too; account IDs are never guessed from names.
INSERT INTO public.competition_participants(id,competition_id,profile_id,name,grade)
SELECT md5(m.competition_id::text||'/helper/'||p.id::text)::uuid,m.competition_id,p.id,p.display_name,coalesce(p.grade,'')
FROM public.profiles p JOIN public.ob_meet_duties d ON d.profile_id=p.id JOIN public.competition_meets m ON m.legacy_source=d.meet_key AND NOT m.ready
WHERE NOT EXISTS(SELECT 1 FROM public.competition_participants person WHERE person.competition_id=m.competition_id AND person.profile_id=p.id) ON CONFLICT DO NOTHING;
WITH sources AS (
 SELECT m.competition_id,e.id participant_id,event_name,e.id::text||CASE WHEN n>1 THEN ':'||n::text ELSE '' END operation_key,n ordinal,e.qualification_marks->>event_name mark,true registered
 FROM public.ob_meet_entries e JOIN public.competition_meets m ON m.legacy_source=e.meet_key AND NOT m.ready CROSS JOIN LATERAL (SELECT event_name,count(*)::integer count FROM unnest(e.events) event_name GROUP BY event_name) counts CROSS JOIN LATERAL generate_series(1,counts.count) n
 UNION
 SELECT m.competition_id,split_part(p->>'entryId',':',1)::uuid,o.event_name,p->>'entryId',coalesce(nullif(split_part(p->>'entryId',':',2),'')::integer,1),NULL,false
 FROM public.ob_event_operations o JOIN public.competition_meets m ON m.legacy_source=o.meet_key AND NOT m.ready CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p
), dedup AS (SELECT competition_id,participant_id,event_name,operation_key,max(ordinal) ordinal,max(mark) mark,bool_or(registered) registered FROM sources GROUP BY 1,2,3,4)
INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,qualification_mark,state,performance)
SELECT md5(s.competition_id::text||'/'||s.event_name||'/'||s.operation_key)::uuid,s.competition_id,s.participant_id,s.event_name,s.ordinal,s.operation_key,s.mark,CASE WHEN s.registered THEN 'registered' ELSE 'cancelled' END,
 coalesce((SELECT value FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') WHERE o.meet_key='ob-2026' AND o.event_name=s.event_name AND value->>'entryId'=s.operation_key),jsonb_build_object('group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb))||jsonb_build_object('entryId',md5(s.competition_id::text||'/'||s.event_name||'/'||s.operation_key)::uuid)
FROM dedup s JOIN public.competition_participants p ON p.id=s.participant_id JOIN public.competition_meet_events e ON e.competition_id=s.competition_id AND e.name=s.event_name ON CONFLICT DO NOTHING;
UPDATE public.competition_meet_events e SET confirmed=(o.data->>'confirmed')::boolean,revision=o.revision
FROM public.ob_event_operations o JOIN public.competition_meets m ON m.legacy_source=o.meet_key AND NOT m.ready
WHERE e.competition_id=m.competition_id AND e.name=o.event_name AND e.revision=0;
INSERT INTO public.competition_meet_duty_roles(id,competition_id,slot_time,event_name,name,required_count,revision,abbreviation)
SELECT r.id,m.competition_id,r.slot_time,CASE r.event_name WHEN '立ち五段跳び' THEN '立ち五段' ELSE r.event_name END,r.name,r.required_count,r.revision,r.abbreviation FROM public.ob_duty_roles r JOIN public.competition_meets m ON m.legacy_source=r.meet_key AND NOT m.ready ON CONFLICT DO NOTHING;
INSERT INTO public.competition_meet_duties(id,competition_id,participant_id,slot_time,event_name,assignment,role_ids,revision,source)
SELECT md5('entry/'||d.meet_key||'/'||d.entry_id::text||'/'||d.slot_time||'/'||d.event_name)::uuid,m.competition_id,d.entry_id,d.slot_time,CASE d.event_name WHEN '立ち五段跳び' THEN '立ち五段' ELSE d.event_name END,d.assignment,d.role_ids,d.revision,'entry'
FROM public.ob_entry_duties d JOIN public.competition_meets m ON m.legacy_source=d.meet_key AND NOT m.ready ON CONFLICT DO NOTHING;
INSERT INTO public.competition_meet_duties(id,competition_id,participant_id,slot_time,event_name,assignment,role_ids,revision,source)
SELECT md5('profile/'||d.meet_key||'/'||d.profile_id::text||'/'||d.slot_time||'/'||d.event_name)::uuid,m.competition_id,p.id,d.slot_time,CASE d.event_name WHEN '立ち五段跳び' THEN '立ち五段' ELSE d.event_name END,d.assignment,d.role_ids,d.revision,'profile'
FROM public.ob_meet_duties d JOIN public.competition_meets m ON m.legacy_source=d.meet_key AND NOT m.ready JOIN public.competition_participants p ON p.competition_id=m.competition_id AND p.profile_id=d.profile_id ON CONFLICT DO NOTHING;
INSERT INTO public.competition_meet_party(id,competition_id,participant_id,name,group_label,status,needs_review,revision)
SELECT r.id,m.competition_id,r.entry_id,r.submitted_name,r.group_label,r.status,r.needs_review,r.revision FROM public.ob_party_responses r JOIN public.competition_meets m ON m.legacy_source=r.meet_key AND NOT m.ready ON CONFLICT DO NOTHING;


 IF p_activate THEN UPDATE public.competition_meets SET ready=true WHERE competition_id=competition; END IF;
 PERFORM set_config('request.headers',coalesce(nullif(headers,''),'{}'),true);
 PERFORM set_config('request.jwt.claims',coalesce(nullif(claims,''),'{}'),true);
 RETURN jsonb_build_object('ready',p_activate,'participants',(SELECT count(*) FROM public.competition_participants WHERE competition_id=competition),'appearances',(SELECT count(*) FROM public.competition_appearances WHERE competition_id=competition));
END $$;
REVOKE ALL ON FUNCTION public.refresh_competition_meet_import(boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_competition_meet_import(boolean,text) TO service_role;
SELECT public.refresh_competition_meet_import(false,NULL);

CREATE OR REPLACE FUNCTION public.get_competition_meet(p_competition_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.competition_meets%ROWTYPE; rights jsonb; snapshot jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.competition_meets WHERE competition_id=p_competition_id;
 IF NOT FOUND OR NOT m.ready THEN RETURN NULL; END IF;
 rights:=public.competition_meet_permissions(p_competition_id);
 SELECT jsonb_build_object('competitionId',m.competition_id,'meetKey',m.meet_key,'name',c.name,'permissions',rights,'program',m.program,'partyInfo',m.party_info,'staffRoleId',m.staff_role_id,'roleOptions',CASE WHEN (rights->>'configure')::boolean THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.roles),'[]'::jsonb) ELSE '[]'::jsonb END,'backend',CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END,
 'participants',coalesce((SELECT jsonb_agg(to_jsonb(p)-'legacy_data' ORDER BY p.grade,p.name,p.id) FROM public.competition_participants p WHERE competition_id=m.competition_id),'[]'::jsonb),
 'appearances',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.event_name,a.participant_id,a.ordinal) FROM public.competition_appearances a WHERE competition_id=m.competition_id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sort_order,e.name) FROM public.competition_meet_events e WHERE competition_id=m.competition_id),'[]'::jsonb),
 'duties',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM public.competition_meet_duties d WHERE competition_id=m.competition_id),'[]'::jsonb),
 'roles',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.competition_meet_duty_roles r WHERE competition_id=m.competition_id),'[]'::jsonb),
 'party',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.competition_meet_party r WHERE competition_id=m.competition_id AND ((rights->>'manage')::boolean OR EXISTS(SELECT 1 FROM public.competition_participants p WHERE p.id=r.participant_id AND p.profile_id=auth.uid()))),'[]'::jsonb),
 'members',CASE WHEN (rights->>'manage')::boolean THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'grade',grade)) FROM public.profiles WHERE approved AND status='active'),'[]'::jsonb) ELSE '[]'::jsonb END)
 INTO snapshot FROM public.competitions c WHERE c.id=m.competition_id;
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION public.get_competition_meet(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_competition_meet(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_competition_meet_history(p_competition_id text,p_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE legacy text;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce((public.competition_meet_permissions(p_competition_id)->>'history')::boolean,false) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 SELECT legacy_source INTO legacy FROM public.competition_meets WHERE competition_id=p_competition_id;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(row) ORDER BY row.time DESC,row.id DESC),'[]'::jsonb) FROM (
  SELECT * FROM (
   SELECT q.id,q.changed_at time,coalesce(q.actor_name,actor.display_name,CASE WHEN q.actor_id IS NULL THEN 'スプレッドシート' ELSE '不明' END) actor,
    coalesce(person.name,q.before_data->>'name',q.command->>'name',q.command->>'event','大会') target,q.command->>'action' action
   FROM public.competition_meet_requests q LEFT JOIN public.profiles actor ON actor.id=q.actor_id
   LEFT JOIN public.competition_appearances appearance ON appearance.competition_id=q.competition_id AND q.command->>'action' LIKE 'appearance.%' AND appearance.id=(q.command->>'id')::uuid
   LEFT JOIN public.competition_participants person ON person.competition_id=q.competition_id AND person.id=coalesce(q.command->>'participantId',CASE WHEN q.command->>'action' LIKE 'participant.%' THEN coalesce(q.command->>'id',q.result->>'id') END,appearance.participant_id::text)::uuid
   WHERE q.competition_id=p_competition_id
   UNION ALL
   SELECT h.id,h.changed_at,coalesce(actor.display_name,'不明'),coalesce(h.after_data->>'submitted_name',h.before_data->>'submitted_name','参加者'),'legacy_entry'
   FROM public.ob_entry_changes h LEFT JOIN public.profiles actor ON actor.id=h.actor_id WHERE coalesce(h.after_data->>'meet_key',h.before_data->>'meet_key')=legacy
   UNION ALL
   SELECT h.id,h.changed_at,coalesce(actor.display_name,'不明'),h.event_name,'legacy_operation'
   FROM public.ob_operation_changes h LEFT JOIN public.profiles actor ON actor.id=h.actor_id WHERE h.meet_key=legacy
  ) changes WHERE p_cursor IS NULL OR (changes.time,changes.id)<((p_cursor->>'time')::timestamptz,(p_cursor->>'id')::uuid)
  ORDER BY changes.time DESC,changes.id DESC LIMIT 30
 ) row);
END $$;
REVOKE ALL ON FUNCTION public.get_competition_meet_history(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_competition_meet_history(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_competition_meet_backend() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END WHERE auth.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.get_competition_meet_backend() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_competition_meet_backend() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_competition_meet_export(p_competition_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('meetKey',m.meet_key,
 'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'grade',grade,'absent',absent,'deleted',deleted,'revision',revision)) FROM public.competition_participants WHERE competition_id=m.competition_id),'[]'::jsonb),
 'appearances',coalesce((SELECT jsonb_agg(to_jsonb(a)-'qualification_mark') FROM public.competition_appearances a WHERE competition_id=m.competition_id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.sort_order,e.name) FROM public.competition_meet_events e WHERE competition_id=m.competition_id),'[]'::jsonb))
 FROM public.competition_meets m WHERE competition_id=p_competition_id AND ready
$$;
REVOKE ALL ON FUNCTION public.get_competition_meet_export(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_meet_export(text) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_competition_sheet_edits(p_request_id uuid,p_context jsonb,p_changes jsonb,p_dry_run boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE competition text:='3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5'; item jsonb; a public.competition_appearances%ROWTYPE; p public.competition_participants%ROWTYPE; e public.competition_meet_events%ROWTYPE;
 previous public.competition_meet_requests%ROWTYPE; payload jsonb; result jsonb; data jsonb; person_id uuid; appearance_id uuid; n integer; source_revisions jsonb; reference public.competition_appearances%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=competition AND ready) THEN
  IF p_context IS NULL THEN RETURN public.apply_ob_sheet_statuses(p_request_id,p_changes,p_dry_run); END IF;
  RETURN public.apply_ob_sheet_edits(p_request_id,p_context,p_changes,p_dry_run);
 END IF;
 IF p_request_id IS NULL OR p_dry_run IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'meet_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||competition,0));
 payload:=jsonb_build_object('action','sheet.edit','changes',p_changes,'context',p_context);
 SELECT * INTO previous FROM public.competition_meet_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id IS NOT NULL OR previous.competition_id<>competition OR previous.command IS DISTINCT FROM payload THEN RAISE EXCEPTION 'meet_request'; END IF;
  RETURN previous.result||jsonb_build_object('dryRun',p_dry_run);
 END IF;
 result:=jsonb_build_object('requestId',p_request_id,'count',jsonb_array_length(p_changes),'dryRun',p_dry_run);
 SELECT coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) INTO source_revisions FROM public.competition_appearances WHERE competition_id=competition;
 BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
   SELECT * INTO e FROM public.competition_meet_events WHERE competition_id=competition AND name=item->>'event' FOR UPDATE;
   IF NOT FOUND OR e.revision IS DISTINCT FROM (item->>'operationRevision')::integer OR e.confirmed THEN RAISE EXCEPTION 'meet_conflict'; END IF;
   IF jsonb_typeof(item->'status') IS DISTINCT FROM 'string' OR item->>'status' NOT IN ('entered','DNS','DNF','DQ') THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   IF item->>'entryId' IS NULL THEN
    IF p_context IS NULL OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 100 OR item->>'grade' IS NULL OR item->>'newKey' IS NULL THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    person_id:=md5(p_request_id::text||'/'||(item->>'newKey'))::uuid;
    INSERT INTO public.competition_participants(id,competition_id,name,grade) VALUES(person_id,competition,btrim(item->>'name'),item->>'grade') ON CONFLICT DO NOTHING;
    SELECT * INTO p FROM public.competition_participants WHERE id=person_id;
    IF p.name IS DISTINCT FROM btrim(item->>'name') OR p.grade IS DISTINCT FROM item->>'grade' THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    SELECT coalesce(max(ordinal),0)+1 INTO n FROM public.competition_appearances WHERE participant_id=person_id AND event_name=e.name;
    appearance_id:=md5(p_request_id::text||'/'||(item->>'newKey')||'/'||e.name)::uuid;
    INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,performance) VALUES(appearance_id,competition,person_id,e.name,n,appearance_id::text,jsonb_build_object('entryId',appearance_id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
    SELECT * INTO a FROM public.competition_appearances WHERE id=appearance_id;
   ELSE
    SELECT * INTO a FROM public.competition_appearances WHERE competition_id=competition AND event_name=e.name AND (id::text=item->>'entryId' OR operation_key=item->>'entryId') FOR UPDATE;
    IF NOT FOUND AND p_context IS NOT NULL THEN
     SELECT * INTO reference FROM public.competition_appearances WHERE competition_id=competition AND (id::text=item->>'entryId' OR operation_key=item->>'entryId') ORDER BY (id::text=item->>'entryId') DESC LIMIT 1 FOR UPDATE;
     IF NOT FOUND OR (source_revisions->>reference.id::text)::integer IS DISTINCT FROM (item->>'entryRevision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
     SELECT coalesce(max(ordinal),0)+1 INTO n FROM public.competition_appearances WHERE participant_id=reference.participant_id AND event_name=e.name;
     appearance_id:=gen_random_uuid();
     INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,performance) VALUES(appearance_id,competition,reference.participant_id,e.name,n,appearance_id::text,jsonb_build_object('entryId',appearance_id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
     SELECT * INTO a FROM public.competition_appearances WHERE id=appearance_id;
    ELSIF NOT FOUND OR (source_revisions->>a.id::text)::integer IS DISTINCT FROM (item->>'entryRevision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    SELECT * INTO p FROM public.competition_participants WHERE id=a.participant_id;
    IF p.deleted OR p.absent OR a.state<>'registered' THEN RAISE EXCEPTION 'meet_unavailable'; END IF;
   END IF;
   data:=a.performance||jsonb_build_object('status',item->>'status');
   IF coalesce((item->>'position')::boolean,false) THEN data:=data||jsonb_build_object('group',item->'group','order',item->'order','heatScope',item->>'heatScope'); END IF;
   IF item->>'status'='DNS' THEN data:=(data-'heatScope')||jsonb_build_object('group',NULL,'order',NULL); END IF;
   IF (data->>'group' IS NOT NULL AND (data->>'group')::integer NOT BETWEEN 1 AND 99) OR (data->>'order' IS NOT NULL AND (data->>'order')::integer NOT BETWEEN 1 AND coalesce(e.capacity,600)) OR (data->>'heatScope' IS NOT NULL AND data->>'heatScope' NOT IN (e.division,'混合')) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   UPDATE public.competition_appearances SET performance=data,revision=revision+1 WHERE id=a.id;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.competition_appearances x JOIN public.competition_meet_events event ON event.competition_id=x.competition_id AND event.name=x.event_name WHERE x.competition_id=competition AND x.performance->>'status'<>'DNS' AND x.performance->>'group' IS NOT NULL AND x.performance->>'order' IS NOT NULL GROUP BY event.family,coalesce(x.performance->>'heatScope',event.division),x.performance->>'group',x.performance->>'order' HAVING count(*)>1) THEN RAISE EXCEPTION 'meet_position'; END IF;
  UPDATE public.competition_meet_events SET revision=revision+1 WHERE competition_id=competition AND name IN (SELECT value->>'event' FROM jsonb_array_elements(p_changes));
  IF p_dry_run THEN RAISE EXCEPTION 'meet_dry_run_rollback' USING ERRCODE='ZX001'; END IF;
  INSERT INTO public.competition_meet_requests(id,competition_id,actor_id,command,result) VALUES(p_request_id,competition,NULL,payload,result);
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN RETURN result;
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_competition_sheet_edits(uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_competition_sheet_edits(uuid,jsonb,jsonb,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.check_competition_meet_mutation(p_competition_id text,p_request_id uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request public.competition_meet_requests%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 IF p_command->>'backend' IS NOT NULL AND p_command->>'backend' IS DISTINCT FROM (CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END) THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||p_competition_id::text,0));
 SELECT * INTO request FROM public.competition_meet_requests WHERE id=p_request_id AND competition_id=p_competition_id AND actor_id=auth.uid();
 IF NOT FOUND THEN RETURN jsonb_build_object('notSaved',true); END IF;
 IF request.command IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'meet_request'; END IF;
 RETURN request.result;
END $$;
REVOKE ALL ON FUNCTION public.check_competition_meet_mutation(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.check_competition_meet_mutation(text,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.competition_meet_trial_valid(p_trial jsonb,p_discipline text,p_wind boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE mark text; result text; parts text[]; segment text; value numeric:=0; part_index integer;
BEGIN
 IF jsonb_typeof(p_trial) IS DISTINCT FROM 'object' OR jsonb_typeof(p_trial->'mark') IS DISTINCT FROM 'string' OR jsonb_typeof(p_trial->'wind') IS DISTINCT FROM 'string' OR jsonb_typeof(p_trial->'status') IS DISTINCT FROM 'string' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_trial) k WHERE k NOT IN ('mark','wind','status')) THEN RETURN false; END IF;
 mark:=p_trial->>'mark';result:=p_trial->>'status';
 IF result NOT IN ('pending','valid','foul','pass') OR length(mark)>30 THEN RETURN false; END IF;
 IF result='pending' THEN RETURN mark='' AND p_trial->>'wind'=''; END IF;
 IF p_discipline='track' AND result<>'valid' THEN RETURN false; END IF;
 IF result<>'valid' AND p_discipline<>'height' THEN RETURN mark='' AND p_trial->>'wind'=''; END IF;
 IF p_discipline='track' THEN
  IF mark !~ '^[0-9]{1,3}(:[0-9]{1,2}){0,2}(\.[0-9]{1,2})?$' THEN RETURN false; END IF;
  parts:=string_to_array(mark,':');
  FOR part_index IN 1..array_length(parts,1) LOOP
   segment:=parts[part_index];
   IF part_index>1 AND segment::numeric>=60 THEN RETURN false; END IF;
   value:=value*60+segment::numeric;
  END LOOP;
 ELSE
  IF mark !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' THEN RETURN false; END IF;
  value:=mark::numeric;
 END IF;
 IF value<=0 THEN RETURN false; END IF;
 RETURN p_trial->>'wind'='' OR (p_wind AND result='valid' AND p_trial->>'wind' ~ '^[+-]?[0-9]{1,2}(\.[0-9])?$');
END $$;
REVOKE ALL ON FUNCTION public.competition_meet_trial_valid(jsonb,text,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.competition_meet_participant_busy(p_competition_id text,p_participant_id uuid,p_time text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.competition_appearances a JOIN public.competition_meet_events e ON e.competition_id=a.competition_id AND e.name=a.event_name WHERE a.competition_id=p_competition_id AND a.participant_id=p_participant_id AND e.starts_at=p_time AND ((a.state='registered' AND a.performance->>'status'<>'DNS') OR a.performance->>'status' IN ('DNF','DQ') OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.performance->'trials') t WHERE t->>'status'<>'pending' OR t->>'mark'<>'' OR t->>'wind'<>'')))
$$;
REVOKE ALL ON FUNCTION public.competition_meet_participant_busy(text,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.mutate_competition_meet(p_competition_id text,p_request_id uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rights jsonb; action text; target_id uuid; p public.competition_participants%ROWTYPE; a public.competition_appearances%ROWTYPE;
 e public.competition_meet_events%ROWTYPE; source_event public.competition_meet_events%ROWTYPE; d public.competition_meet_duties%ROWTYPE; r public.competition_meet_party%ROWTYPE; duty_role public.competition_meet_duty_roles%ROWTYPE;
 previous public.competition_meet_requests%ROWTYPE; item jsonb; data jsonb; trial jsonb; before_value jsonb; result jsonb; selected_roles uuid[]; next_ordinal integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved) OR p_request_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR pg_column_size(p_command)>250000 THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 IF p_command->>'backend' IS NOT NULL AND p_command->>'backend' IS DISTINCT FROM (CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END) THEN RAISE EXCEPTION 'meet_backend_changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||p_competition_id::text,0));
 SELECT * INTO previous FROM public.competition_meet_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM auth.uid() OR previous.competition_id<>p_competition_id OR previous.command IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'meet_request'; END IF;
  RETURN previous.result;
 END IF;
 action:=p_command->>'action'; rights:=public.competition_meet_permissions(p_competition_id);
 IF action='event.configure' THEN
  IF NOT (rights->>'configure')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=p_competition_id AND NOT ready) THEN RAISE EXCEPTION 'meet_pending'; END IF;
  INSERT INTO public.competition_meets(competition_id,meet_key,ready) VALUES(p_competition_id,p_competition_id::text,true) ON CONFLICT DO NOTHING;
  data:=p_command->'config';
  IF jsonb_typeof(data)<>'object' OR length(btrim(data->>'name')) NOT BETWEEN 1 AND 100 OR length(btrim(data->>'family')) NOT BETWEEN 1 AND 100
   OR data->>'division' NOT IN ('男子','女子','混合') OR data->>'discipline' NOT IN ('track','height','distance') OR (data->>'starts_at' IS NOT NULL AND data->>'starts_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  IF EXISTS(SELECT 1 FROM public.competition_meet_events WHERE competition_id=p_competition_id AND name=data->>'name') THEN RAISE EXCEPTION 'meet_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM public.competition_meet_events WHERE competition_id=p_competition_id AND family=data->>'family' AND (discipline IS DISTINCT FROM data->>'discipline' OR wind IS DISTINCT FROM coalesce((data->>'wind')::boolean,false) OR capacity IS DISTINCT FROM (data->>'capacity')::integer)) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,sort_order,discipline,wind,capacity)
  VALUES(p_competition_id,data->>'name',data->>'family',data->>'division',data->>'starts_at',coalesce((data->>'sort_order')::integer,0),data->>'discipline',coalesce((data->>'wind')::boolean,false),(data->>'capacity')::integer);
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=p_competition_id AND ready) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  IF p_command->>'id' IS NOT NULL THEN target_id:=(p_command->>'id')::uuid; END IF;
  IF action='meet.configure' THEN
   IF NOT (rights->>'configure')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   IF (SELECT staff_role_id FROM public.competition_meets WHERE competition_id=p_competition_id) IS DISTINCT FROM (p_command->>'expectedStaffRoleId')::uuid THEN RAISE EXCEPTION 'meet_conflict'; END IF;
   UPDATE public.competition_meets SET staff_role_id=(p_command->>'staffRoleId')::uuid WHERE competition_id=p_competition_id;
  ELSIF action LIKE 'participant.%' THEN
   IF target_id IS NOT NULL THEN SELECT * INTO p FROM public.competition_participants WHERE id=target_id AND competition_id=p_competition_id FOR UPDATE;
    IF NOT FOUND OR p.revision IS DISTINCT FROM (p_command->>'revision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    before_value:=to_jsonb(p);
   END IF;
   IF NOT (rights->>'manage')::boolean AND NOT (action='participant.save' AND (target_id IS NULL OR p.profile_id=auth.uid())) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   IF action='participant.save' THEN
    IF jsonb_typeof(p_command->'name') IS DISTINCT FROM 'string' OR length(btrim(p_command->>'name')) NOT BETWEEN 1 AND 100 OR p_command->>'grade' IS NULL THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    IF target_id IS NULL THEN
     IF NOT (rights->>'manage')::boolean AND (p_command->>'profileId')::uuid IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
     IF EXISTS(SELECT 1 FROM public.competition_participants WHERE competition_id=p_competition_id AND profile_id=(p_command->>'profileId')::uuid) THEN RAISE EXCEPTION 'meet_profile'; END IF;
     INSERT INTO public.competition_participants(competition_id,profile_id,name,grade) VALUES(p_competition_id,(p_command->>'profileId')::uuid,btrim(p_command->>'name'),p_command->>'grade') RETURNING id INTO target_id;
    ELSE
     IF NOT (rights->>'manage')::boolean AND ((p_command->>'profileId')::uuid IS DISTINCT FROM p.profile_id OR btrim(p_command->>'name') IS DISTINCT FROM p.name OR p_command->>'grade' IS DISTINCT FROM p.grade) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
     UPDATE public.competition_participants SET name=btrim(p_command->>'name'),grade=p_command->>'grade',profile_id=(p_command->>'profileId')::uuid,revision=revision+1 WHERE id=target_id;
    END IF;
   ELSIF action IN ('participant.delete','participant.restore','participant.attendance') THEN
    IF target_id IS NULL THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    IF EXISTS(SELECT 1 FROM public.competition_appearances x JOIN public.competition_meet_events event ON event.competition_id=x.competition_id AND event.name=x.event_name WHERE x.participant_id=p.id AND event.confirmed) THEN RAISE EXCEPTION 'meet_confirmed'; END IF;
    IF action='participant.attendance' AND jsonb_typeof(p_command->'absent') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    -- Soft deletion retains duties; inactive participants are excluded from staffing counts.
    before_value:=jsonb_build_object('participant',to_jsonb(p),'appearances',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.competition_appearances x WHERE participant_id=p.id));
    UPDATE public.competition_participants SET deleted=CASE WHEN action='participant.delete' THEN true WHEN action='participant.restore' THEN false ELSE deleted END,absent=CASE WHEN action='participant.attendance' THEN (p_command->>'absent')::boolean ELSE absent END,revision=revision+1 WHERE id=p.id;
    -- Restoration is explicitly unplaced. Trials and each registration ID survive.
    UPDATE public.competition_appearances SET state=CASE WHEN state='registered' AND (action='participant.delete' OR (action='participant.attendance' AND (p_command->>'absent')::boolean)) THEN 'cancelled' ELSE state END,performance=(performance-'heatScope')||jsonb_build_object('group',NULL,'order',NULL),revision=revision+1 WHERE participant_id=p.id;
   ELSE RAISE EXCEPTION 'meet_invalid'; END IF;
  ELSIF action LIKE 'appearance.%' THEN
   IF action='appearance.add' THEN
    IF p_command->>'mark' IS NOT NULL AND (jsonb_typeof(p_command->'mark') IS DISTINCT FROM 'string' OR length(p_command->>'mark')>1000) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    SELECT * INTO p FROM public.competition_participants WHERE id=(p_command->>'participantId')::uuid AND competition_id=p_competition_id FOR UPDATE;
    SELECT * INTO e FROM public.competition_meet_events WHERE competition_id=p_competition_id AND name=p_command->>'event' FOR UPDATE;
    IF p.id IS NULL OR e.name IS NULL THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   ELSE
    SELECT * INTO a FROM public.competition_appearances WHERE id=target_id AND competition_id=p_competition_id FOR UPDATE;
    IF NOT FOUND OR a.revision IS DISTINCT FROM (p_command->>'revision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    SELECT * INTO p FROM public.competition_participants WHERE id=a.participant_id;
    SELECT * INTO e FROM public.competition_meet_events WHERE competition_id=p_competition_id AND name=a.event_name FOR UPDATE;
    before_value:=to_jsonb(a);
   END IF;
   IF NOT (rights->>'manage')::boolean AND p.profile_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   IF action IN ('appearance.add','appearance.restore') AND (p.deleted OR p.absent) THEN RAISE EXCEPTION 'meet_unavailable'; END IF;
   IF e.confirmed THEN RAISE EXCEPTION 'meet_confirmed'; END IF;
   IF action IN ('appearance.add','appearance.restore') AND EXISTS(SELECT 1 FROM public.competition_meet_duties WHERE participant_id=p.id AND slot_time=e.starts_at AND (assignment<>'' OR cardinality(role_ids)>0)) AND NOT coalesce((p_command->>'confirmDuties')::boolean,false) THEN RAISE EXCEPTION 'meet_duty_confirmation'; END IF;
   IF action='appearance.add' THEN
    SELECT coalesce(max(ordinal),0)+1 INTO next_ordinal FROM public.competition_appearances WHERE participant_id=p.id AND event_name=e.name;
    target_id:=gen_random_uuid();
    INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,qualification_mark,performance)
    VALUES(target_id,p_competition_id,p.id,e.name,next_ordinal,target_id::text,p_command->>'mark',jsonb_build_object('entryId',target_id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
   ELSIF action='appearance.edit' THEN
    IF p_command->>'mark' IS NOT NULL AND (jsonb_typeof(p_command->'mark') IS DISTINCT FROM 'string' OR length(p_command->>'mark')>1000) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    UPDATE public.competition_appearances SET qualification_mark=p_command->>'mark',revision=revision+1 WHERE id=a.id;
   ELSIF action IN ('appearance.cancel','appearance.delete','appearance.restore') THEN
    UPDATE public.competition_appearances SET state=CASE action WHEN 'appearance.cancel' THEN 'cancelled' WHEN 'appearance.delete' THEN 'deleted' ELSE 'registered' END,
     performance=(performance-'heatScope')||jsonb_build_object('status',CASE WHEN action='appearance.restore' AND performance->>'status'='DNS' THEN 'entered' ELSE performance->>'status' END,'group',NULL,'order',NULL),revision=revision+1 WHERE id=a.id;
   ELSE RAISE EXCEPTION 'meet_invalid'; END IF;
  ELSIF action='event.save' THEN
   IF NOT (rights->>'record')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   SELECT * INTO e FROM public.competition_meet_events WHERE competition_id=p_competition_id AND name=p_command->>'event' FOR UPDATE;
   IF NOT FOUND OR (e.revision IS DISTINCT FROM (p_command->>'revision')::integer AND NOT (p_command->'expectedConfirmed' IS NOT NULL AND e.confirmed IS NOT DISTINCT FROM (p_command->>'expectedConfirmed')::boolean AND e.confirmed IS NOT DISTINCT FROM (p_command->>'confirmed')::boolean)) THEN RAISE EXCEPTION 'meet_conflict'; END IF;
   IF jsonb_typeof(p_command->'changes') IS DISTINCT FROM 'array' OR jsonb_array_length(p_command->'changes')>1000 OR jsonb_typeof(p_command->'confirmed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_command->'changes'))<>jsonb_array_length(p_command->'changes') THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   IF e.confirmed AND (p_command->>'confirmed')::boolean AND jsonb_array_length(p_command->'changes')>0 THEN RAISE EXCEPTION 'meet_confirmed'; END IF;
   IF NOT (rights->>'groups')::boolean AND e.confirmed IS DISTINCT FROM (p_command->>'confirmed')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   before_value:=jsonb_build_object('event',to_jsonb(e),'appearances',(SELECT jsonb_agg(to_jsonb(x)) FROM public.competition_appearances x WHERE competition_id=p_competition_id AND id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_command->'changes'))));
   FOR item IN SELECT value FROM jsonb_array_elements(p_command->'changes') LOOP
    SELECT x.* INTO a FROM public.competition_appearances x JOIN public.competition_meet_events definition ON definition.competition_id=x.competition_id AND definition.name=x.event_name WHERE x.id=(item->>'id')::uuid AND x.competition_id=p_competition_id AND definition.family=e.family FOR UPDATE OF x;
    IF NOT FOUND OR a.revision IS DISTINCT FROM (item->>'revision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    SELECT * INTO source_event FROM public.competition_meet_events WHERE competition_id=p_competition_id AND name=a.event_name;
    IF source_event.name<>e.name AND source_event.confirmed THEN RAISE EXCEPTION 'meet_confirmed'; END IF;
    SELECT * INTO p FROM public.competition_participants WHERE id=a.participant_id;
    data:=item->'performance';
    IF jsonb_typeof(data) IS DISTINCT FROM 'object' OR data->>'entryId' IS DISTINCT FROM a.id::text OR jsonb_typeof(data->'status') IS DISTINCT FROM 'string' OR data->>'status' NOT IN ('entered','DNS','DNF','DQ') OR jsonb_typeof(data->'trials') IS DISTINCT FROM 'array' OR NOT data?'group' OR NOT data?'order' OR jsonb_typeof(data->'group') NOT IN ('number','null') OR jsonb_typeof(data->'order') NOT IN ('number','null') OR EXISTS(SELECT 1 FROM jsonb_object_keys(data) k WHERE k NOT IN ('entryId','group','order','status','trials','heatScope')) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    IF (p.deleted OR p.absent OR a.state<>'registered') AND data IS DISTINCT FROM a.performance THEN RAISE EXCEPTION 'meet_unavailable'; END IF;
    IF data->>'status'='DNS' THEN data:=(data-'heatScope')||jsonb_build_object('group',NULL,'order',NULL); END IF;
    IF NOT (rights->>'groups')::boolean AND data->>'status'<>'DNS' AND (data->'group' IS DISTINCT FROM a.performance->'group' OR data->'order' IS DISTINCT FROM a.performance->'order' OR coalesce(data->>'heatScope',source_event.division) IS DISTINCT FROM coalesce(a.performance->>'heatScope',source_event.division)) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
    IF (data->>'group' IS NOT NULL AND (data->>'group') !~ '^[1-9][0-9]?$') OR (data->>'order' IS NOT NULL AND ((data->>'order') !~ '^[1-9][0-9]{0,2}$' OR (data->>'order')::integer>600)) OR (data->>'order' IS NOT NULL AND (data->>'order')::integer>coalesce(source_event.capacity,600) AND (data->'group' IS DISTINCT FROM a.performance->'group' OR data->'order' IS DISTINCT FROM a.performance->'order')) OR (data->>'heatScope' IS NOT NULL AND data->>'heatScope' NOT IN (source_event.division,'混合')) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    IF jsonb_array_length(data->'trials')>(CASE source_event.discipline WHEN 'track' THEN 1 WHEN 'height' THEN 30 ELSE 6 END) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    FOR trial IN SELECT value FROM jsonb_array_elements(data->'trials') LOOP
     IF NOT public.competition_meet_trial_valid(trial,source_event.discipline,source_event.wind) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    END LOOP;
    UPDATE public.competition_appearances SET performance=data,revision=revision+1 WHERE id=a.id;
   END LOOP;
   -- Include both divisions of a shared family when checking assigned slots.
   IF EXISTS(SELECT 1 FROM public.competition_appearances x JOIN public.competition_meet_events event ON event.competition_id=x.competition_id AND event.name=x.event_name WHERE x.competition_id=p_competition_id AND event.family=e.family AND x.performance->>'status'<>'DNS' AND x.performance->>'group' IS NOT NULL AND x.performance->>'order' IS NOT NULL GROUP BY coalesce(x.performance->>'heatScope',event.division),x.performance->>'group',x.performance->>'order' HAVING count(*)>1) THEN RAISE EXCEPTION 'meet_position'; END IF;
   IF (p_command->>'confirmed')::boolean AND EXISTS(SELECT 1 FROM public.competition_appearances x JOIN public.competition_participants person ON person.id=x.participant_id WHERE x.competition_id=p_competition_id AND x.event_name=e.name AND x.state='registered' AND NOT person.absent AND NOT person.deleted AND x.performance->>'status'='entered' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x.performance->'trials') t WHERE t->>'status' IN ('valid','foul'))) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   UPDATE public.competition_meet_events SET confirmed=CASE WHEN name=e.name THEN (p_command->>'confirmed')::boolean ELSE confirmed END,revision=revision+1 WHERE competition_id=p_competition_id AND (name=e.name OR name IN (SELECT x.event_name FROM public.competition_appearances x WHERE x.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_command->'changes'))));
  ELSIF action IN ('role.save','role.delete') THEN
   IF NOT (rights->>'manage')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   IF target_id IS NOT NULL THEN
    SELECT * INTO duty_role FROM public.competition_meet_duty_roles WHERE id=target_id AND competition_id=p_competition_id FOR UPDATE;
    IF NOT FOUND OR duty_role.revision IS DISTINCT FROM (p_command->>'revision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    before_value:=to_jsonb(duty_role);
   END IF;
   IF action='role.delete' THEN
    IF target_id IS NULL OR EXISTS(SELECT 1 FROM public.competition_meet_duties WHERE target_id=ANY(role_ids)) THEN RAISE EXCEPTION 'meet_duties'; END IF;
    DELETE FROM public.competition_meet_duty_roles WHERE id=target_id;
   ELSE
    IF jsonb_typeof(p_command->'name') IS DISTINCT FROM 'string' OR length(btrim(p_command->>'name')) NOT BETWEEN 1 AND 200 OR p_command->>'time' IS NULL OR p_command->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (p_command->>'requiredCount')::integer NOT BETWEEN 0 AND 99 OR NOT (EXISTS(SELECT 1 FROM public.competition_meet_events WHERE competition_id=p_competition_id AND family=p_command->>'event') OR EXISTS(SELECT 1 FROM public.competition_meets m CROSS JOIN LATERAL jsonb_array_elements(m.program) slot WHERE m.competition_id=p_competition_id AND slot->>'label'=p_command->>'event' AND slot?'note')) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
    IF target_id IS NULL THEN
     INSERT INTO public.competition_meet_duty_roles(competition_id,slot_time,event_name,name,required_count) VALUES(p_competition_id,p_command->>'time',p_command->>'event',btrim(p_command->>'name'),(p_command->>'requiredCount')::integer) RETURNING id INTO target_id;
    ELSE
     IF (p_command->>'requiredCount')::integer<(SELECT count(DISTINCT helper.participant_id) FROM public.competition_meet_duties helper JOIN public.competition_participants person ON person.id=helper.participant_id WHERE target_id=ANY(helper.role_ids) AND NOT person.deleted AND NOT person.absent AND NOT public.competition_meet_participant_busy(p_competition_id,person.id,helper.slot_time)) THEN RAISE EXCEPTION 'meet_duties'; END IF;
     UPDATE public.competition_meet_duty_roles SET name=btrim(p_command->>'name'),required_count=(p_command->>'requiredCount')::integer,revision=revision+1 WHERE id=target_id;
    END IF;
   END IF;
  ELSIF action='duty.save' THEN
   IF NOT (rights->>'manage')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
   SELECT * INTO d FROM public.competition_meet_duties WHERE id=target_id AND competition_id=p_competition_id FOR UPDATE;
   IF target_id IS NOT NULL AND (NOT FOUND OR d.revision IS DISTINCT FROM (p_command->>'revision')::integer) THEN RAISE EXCEPTION 'meet_conflict'; END IF;
   IF target_id IS NULL THEN d.slot_time:=p_command->>'time';d.event_name:=p_command->>'event';IF d.slot_time IS NULL OR d.slot_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR d.event_name IS NULL OR NOT (EXISTS(SELECT 1 FROM public.competition_meet_events WHERE competition_id=p_competition_id AND family=d.event_name) OR EXISTS(SELECT 1 FROM public.competition_meets m CROSS JOIN LATERAL jsonb_array_elements(m.program) slot WHERE m.competition_id=p_competition_id AND slot->>'label'=d.event_name AND slot?'note')) THEN RAISE EXCEPTION 'meet_invalid'; END IF; END IF;
   IF jsonb_typeof(coalesce(p_command->'roleIds','[]'::jsonb)) IS DISTINCT FROM 'array' OR length(coalesce(p_command->>'assignment',''))>1000 THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   SELECT * INTO p FROM public.competition_participants WHERE id=(p_command->>'participantId')::uuid AND competition_id=p_competition_id;
   IF p.id IS NULL THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   SELECT coalesce(array_agg(value::uuid),'{}') INTO selected_roles FROM jsonb_array_elements_text(coalesce(p_command->'roleIds','[]'::jsonb));
   IF cardinality(selected_roles)<>(SELECT count(*) FROM public.competition_meet_duty_roles WHERE id=ANY(selected_roles) AND competition_id=p_competition_id AND slot_time=d.slot_time AND event_name=d.event_name) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   IF cardinality(selected_roles)>0 OR coalesce(p_command->>'assignment','')<>'' THEN
    IF p.deleted OR p.absent OR p.grade='OB・OG' THEN RAISE EXCEPTION 'meet_unavailable'; END IF;
    IF public.competition_meet_participant_busy(p_competition_id,p.id,d.slot_time) OR EXISTS(SELECT 1 FROM public.competition_meet_duties WHERE id IS DISTINCT FROM d.id AND participant_id=p.id AND slot_time=d.slot_time AND (cardinality(role_ids)>0 OR assignment<>'')) THEN RAISE EXCEPTION 'meet_duties'; END IF;
   END IF;
   before_value:=to_jsonb(d);
   IF target_id IS NULL THEN
    INSERT INTO public.competition_meet_duties(competition_id,participant_id,slot_time,event_name,role_ids,assignment) VALUES(p_competition_id,p.id,d.slot_time,d.event_name,selected_roles,coalesce(p_command->>'assignment','')) RETURNING id INTO target_id;
   ELSE UPDATE public.competition_meet_duties SET participant_id=p.id,role_ids=selected_roles,assignment=coalesce(p_command->>'assignment',''),revision=revision+1 WHERE id=d.id; END IF;
  ELSIF action='party.save' THEN
   IF jsonb_typeof(p_command->'status') IS DISTINCT FROM 'string' OR p_command->>'status' NOT IN ('参加','不参加','未回答') THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   IF target_id IS NULL THEN
    SELECT * INTO p FROM public.competition_participants WHERE id=(p_command->>'participantId')::uuid AND competition_id=p_competition_id;
    IF p.id IS NULL OR p.deleted THEN RAISE EXCEPTION 'meet_unavailable'; END IF;
    IF NOT (rights->>'manage')::boolean AND p.profile_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.competition_meet_party WHERE competition_id=p_competition_id AND participant_id=p.id) THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    INSERT INTO public.competition_meet_party(competition_id,participant_id,name,group_label,status) VALUES(p_competition_id,p.id,p.name,p.grade,p_command->>'status') RETURNING id INTO target_id;
   ELSE
    SELECT * INTO r FROM public.competition_meet_party WHERE id=target_id AND competition_id=p_competition_id FOR UPDATE;
    IF NOT FOUND OR r.revision IS DISTINCT FROM (p_command->>'revision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
    IF NOT (rights->>'manage')::boolean AND NOT EXISTS(SELECT 1 FROM public.competition_participants WHERE id=r.participant_id AND profile_id=auth.uid()) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
    before_value:=to_jsonb(r);
    IF p_command?'participantId' AND (p_command->>'participantId')::uuid IS DISTINCT FROM r.participant_id THEN
     IF NOT (rights->>'manage')::boolean THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
     SELECT * INTO p FROM public.competition_participants WHERE id=(p_command->>'participantId')::uuid AND competition_id=p_competition_id;
     IF p.id IS NULL OR EXISTS(SELECT 1 FROM public.competition_meet_party WHERE competition_id=p_competition_id AND participant_id=p.id AND id<>r.id) THEN RAISE EXCEPTION 'meet_conflict'; END IF;
     UPDATE public.competition_meet_party SET participant_id=p.id,needs_review=false WHERE id=r.id;
    END IF;
    UPDATE public.competition_meet_party SET status=p_command->>'status',revision=revision+1 WHERE id=r.id;
   END IF;
  ELSE RAISE EXCEPTION 'meet_invalid'; END IF;
 END IF;
 result:=jsonb_build_object('requestId',p_request_id,'id',target_id);
 INSERT INTO public.competition_meet_requests(id,competition_id,actor_id,actor_name,command,result,before_data) VALUES(p_request_id,p_competition_id,auth.uid(),(SELECT display_name FROM public.profiles WHERE id=auth.uid()),p_command,result,before_value);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mutate_competition_meet(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_competition_meet(text,uuid,jsonb) TO authenticated;

-- Old app tabs fail explicitly after activation; no second writable source remains.
CREATE OR REPLACE FUNCTION public.reject_migrated_ob_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_mirror_write() AND EXISTS(SELECT 1 FROM public.competition_meets WHERE legacy_source=CASE WHEN TG_OP='DELETE' THEN OLD.meet_key ELSE NEW.meet_key END AND (ready OR (source_frozen AND coalesce(auth.role(),'')<>'service_role'))) THEN RAISE EXCEPTION 'meet_migrated_reload'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.reject_migrated_ob_write() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.set_competition_meet_source_frozen(p_frozen boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_frozen IS NULL THEN RAISE EXCEPTION 'meet_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5',0));
 LOCK TABLE public.ob_meet_entries,public.ob_event_operations,public.ob_meet_duties,public.ob_entry_duties,public.ob_duty_roles,public.ob_party_responses IN SHARE ROW EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE legacy_source='ob-2026' AND NOT ready) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
 UPDATE public.competition_meets SET source_frozen=p_frozen WHERE legacy_source='ob-2026' AND NOT ready;
 RETURN jsonb_build_object('frozen',p_frozen);
END $$;
REVOKE ALL ON FUNCTION public.set_competition_meet_source_frozen(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_competition_meet_source_frozen(boolean) TO service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ob_meet_entries','ob_event_operations','ob_meet_duties','ob_entry_duties','ob_duty_roles','ob_party_responses'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS aa_meet_migrated_readonly ON public.%I',t);
  EXECUTE format('CREATE TRIGGER aa_meet_migrated_readonly BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_migrated_ob_write()',t);
 END LOOP;
END $$;
-- Attach journals after the initial import: bootstrap snapshots are not outage writes.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['competition_meets','competition_meet_events','competition_participants','competition_appearances','competition_meet_duty_roles','competition_meet_duties','competition_meet_party','competition_meet_requests'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS zz_log_failover_change ON public.%I',t);
  IF t='competition_meet_events' THEN
   EXECUTE format('CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_failover_change(''competition_id'',''name'')',t);
  ELSE
   EXECUTE format('CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_failover_change(%L)',t,CASE WHEN t='competition_meets' THEN 'competition_id' ELSE 'id' END);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.replay_competition_meet_changes(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; target text; keys text; columns text; affected integer;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 OR pg_column_size(p_rows)>2000000 THEN RAISE EXCEPTION 'meet_invalid'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY (CASE WHEN value->>'op'='DELETE' THEN -1 ELSE 1 END)*(CASE value->>'table_name'
 WHEN 'competition_meets' THEN 1 WHEN 'competition_meet_events' THEN 2 WHEN 'competition_participants' THEN 3 WHEN 'competition_appearances' THEN 4 WHEN 'competition_meet_duty_roles' THEN 5 WHEN 'competition_meet_duties' THEN 6 WHEN 'competition_meet_party' THEN 7 WHEN 'competition_meet_requests' THEN 8 ELSE 99 END),(value->>'id')::bigint LOOP
  target:=item->>'table_name';
  IF target NOT IN ('competition_meets','competition_meet_events','competition_participants','competition_appearances','competition_meet_duty_roles','competition_meet_duties','competition_meet_party','competition_meet_requests') OR jsonb_typeof(item->'pk') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  keys:=CASE target WHEN 'competition_meets' THEN 'competition_id' WHEN 'competition_meet_events' THEN 'competition_id,name' ELSE 'id' END;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(item->'pk') k) IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(string_to_array(keys,',')) k) OR EXISTS(SELECT 1 FROM jsonb_each(item->'pk') WHERE jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  IF item->>'op'<>'DELETE' AND (jsonb_typeof(item->'row_data') IS DISTINCT FROM 'object' OR NOT ((item->'row_data') @> (item->'pk'))) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  IF item->>'op'='UPDATE' AND jsonb_typeof(item->'changed') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'meet_invalid'; END IF;
  IF item->>'op'='DELETE' THEN
   EXECUTE format('DELETE FROM public.%I t WHERE to_jsonb(t) @> $1',target) USING item->'pk';
  ELSIF item->>'op'='INSERT' THEN
   EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I,$1) ON CONFLICT(%s) DO NOTHING',target,target,keys) USING item->'row_data';
  ELSIF item->>'op'='UPDATE' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(item->'changed') name WHERE name=ANY(string_to_array(keys,',')) OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=target AND column_name=name)) THEN RAISE EXCEPTION 'meet_invalid'; END IF;
   SELECT string_agg(format('%I=r.%I',name,name),',') INTO columns FROM jsonb_array_elements_text(item->'changed') name
   WHERE name IN (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=target) AND name<>ALL(string_to_array(keys,','));
   IF columns IS NULL THEN CONTINUE; END IF;
   EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE to_jsonb(t) @> $2',target,columns,target) USING item->'row_data',item->'pk';
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected=0 THEN EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I,$1) ON CONFLICT(%s) DO NOTHING',target,target,keys) USING item->'row_data'; END IF;
  ELSE RAISE EXCEPTION 'meet_invalid'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.competition_appearances a JOIN public.competition_participants p ON p.id=a.participant_id JOIN public.competition_meet_events e ON e.competition_id=a.competition_id AND e.name=a.event_name WHERE a.state='registered' AND NOT p.deleted AND NOT p.absent AND a.performance->>'status'<>'DNS' AND a.performance->>'group' IS NOT NULL AND a.performance->>'order' IS NOT NULL GROUP BY a.competition_id,e.family,coalesce(a.performance->>'heatScope',e.division),a.performance->>'group',a.performance->>'order' HAVING count(*)>1) THEN RAISE EXCEPTION 'meet_position'; END IF;
 IF EXISTS(SELECT 1 FROM public.competition_meet_duties d CROSS JOIN LATERAL unnest(d.role_ids) role_id WHERE NOT EXISTS(SELECT 1 FROM public.competition_meet_duty_roles r WHERE r.id=role_id AND r.competition_id=d.competition_id AND r.slot_time=d.slot_time AND r.event_name=d.event_name)) THEN RAISE EXCEPTION 'meet_duties'; END IF;
 RETURN jsonb_build_object('count',jsonb_array_length(p_rows));
END $$;
REVOKE ALL ON FUNCTION public.replay_competition_meet_changes(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replay_competition_meet_changes(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_competition_meet_mirror() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'competition_meets',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_meets t),
 'competition_meet_events',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_meet_events t),
 'competition_participants',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_participants t),
 'competition_appearances',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_appearances t),
 'competition_meet_duty_roles',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_meet_duty_roles t),
 'competition_meet_duties',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_meet_duties t),
 'competition_meet_party',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_meet_party t),
 'competition_meet_requests',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.competition_meet_requests t))
$$;
REVOKE ALL ON FUNCTION public.get_competition_meet_mirror() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_competition_meet_mirror() TO service_role;
NOTIFY pgrst,'reload schema';

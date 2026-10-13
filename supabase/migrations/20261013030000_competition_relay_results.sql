-- One six-lane relay result belongs to its event, without synthetic people.
ALTER TABLE public.competition_meet_events ADD COLUMN IF NOT EXISTS relay_results jsonb;

CREATE OR REPLACE FUNCTION public.competition_relay_results_valid(teams jsonb,confirmed boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE team jsonb; n integer:=0; entered integer:=0; name text; time text;
BEGIN
 IF teams IS NULL OR jsonb_typeof(teams)<>'array' OR jsonb_array_length(teams)<>6 OR confirmed IS NULL THEN RETURN false; END IF;
 FOR team IN SELECT value FROM jsonb_array_elements(teams) LOOP
  n:=n+1;
  IF jsonb_typeof(team)<>'object' OR jsonb_typeof(team->'lane') IS DISTINCT FROM 'number' OR team->>'lane'<>n::text
   OR jsonb_typeof(team->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(team->'time') IS DISTINCT FROM 'string'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(team) k WHERE k NOT IN ('lane','name','time','members')) THEN RETURN false; END IF;
  IF jsonb_typeof(team->'members') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(team->'members')<>4 OR EXISTS(SELECT 1 FROM jsonb_array_elements(team->'members') member WHERE jsonb_typeof(member)<>'string' OR length(member#>>'{}')>100) THEN RETURN false; END IF;
  name:=btrim(team->>'name');time:=team->>'time';
  IF name='' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(team->'members') member WHERE btrim(member)<>'') THEN RETURN false; END IF;
  IF length(team->>'name')>100 THEN RETURN false; END IF;
  IF name<>'' THEN entered:=entered+1; END IF;
  IF time<>'' AND (name='' OR NOT public.competition_meet_trial_valid(jsonb_build_object('mark',time,'wind','','status','valid'),'track',false)) THEN RETURN false; END IF;
  IF confirmed AND name<>'' AND time='' THEN RETURN false; END IF;
 END LOOP;
 RETURN NOT confirmed OR entered>0;
END $$;
REVOKE ALL ON FUNCTION public.competition_relay_results_valid(jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.competition_relay_results_valid(jsonb,boolean) TO authenticated,service_role;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.competition_meet_events'::regclass AND conname='competition_relay_six_lanes') THEN
  ALTER TABLE public.competition_meet_events ADD CONSTRAINT competition_relay_six_lanes CHECK(relay_results IS NULL OR
   (discipline='track' AND capacity=6 AND NOT wind AND division='混合' AND public.competition_relay_results_valid(relay_results,confirmed)));
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_competition_relay_appearance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.competition_meet_events WHERE competition_id=NEW.competition_id AND name=NEW.event_name AND relay_results IS NOT NULL)
 THEN RAISE EXCEPTION 'meet_relay_team'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_competition_relay_appearance() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_relay_team_entry ON public.competition_appearances;
CREATE TRIGGER guard_relay_team_entry BEFORE INSERT OR UPDATE OF event_name,competition_id ON public.competition_appearances
 FOR EACH ROW EXECUTE FUNCTION public.guard_competition_relay_appearance();

CREATE OR REPLACE FUNCTION public.save_competition_relay_checked(p_competition_id text,p_request_id uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.competition_meet_requests%ROWTYPE; event public.competition_meet_events%ROWTYPE; rights jsonb; teams jsonb; desired_confirmed boolean; result jsonb; after_value jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved)
  OR p_request_id IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_command->>'action' IS DISTINCT FROM 'relay.save' OR pg_column_size(p_command)>250000
 THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 IF p_command->>'backend' IS NOT NULL AND p_command->>'backend' IS DISTINCT FROM
  (CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END)
 THEN RAISE EXCEPTION 'meet_backend_changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||p_competition_id,0));
 rights:=public.competition_meet_permissions(p_competition_id);
 IF NOT coalesce((rights->>'record')::boolean,false) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.competition_meet_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM auth.uid() OR previous.competition_id IS DISTINCT FROM p_competition_id OR previous.command IS DISTINCT FROM p_command THEN RAISE EXCEPTION 'meet_request'; END IF;
  RETURN previous.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=p_competition_id AND ready) THEN RAISE EXCEPTION 'meet_pending'; END IF;
 SELECT * INTO event FROM public.competition_meet_events WHERE competition_id=p_competition_id AND name=p_command->>'event' FOR UPDATE;
 IF NOT FOUND OR event.relay_results IS NULL THEN RAISE EXCEPTION 'meet_relay_team'; END IF;
 IF event.revision IS DISTINCT FROM (p_command->>'revision')::integer THEN RAISE EXCEPTION 'meet_conflict'; END IF;
 IF jsonb_typeof(p_command->'confirmed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'meet_relay_invalid'; END IF;
 teams:=p_command->'relayResults';desired_confirmed:=(p_command->>'confirmed')::boolean;
 IF event.confirmed AND teams IS DISTINCT FROM event.relay_results THEN RAISE EXCEPTION 'meet_confirmed'; END IF;
 IF NOT public.competition_relay_results_valid(teams,desired_confirmed) THEN RAISE EXCEPTION 'meet_relay_invalid'; END IF;
 IF desired_confirmed IS DISTINCT FROM event.confirmed AND NOT coalesce((rights->>'groups')::boolean,false) THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.competition_meet_events SET relay_results=teams,confirmed=desired_confirmed,revision=revision+1
 WHERE competition_id=p_competition_id AND name=event.name RETURNING to_jsonb(competition_meet_events) INTO after_value;
 result:=jsonb_build_object('requestId',p_request_id,'id',event.name);
 INSERT INTO public.competition_meet_requests(id,competition_id,actor_id,actor_name,command,result,before_data,after_data)
 VALUES(p_request_id,p_competition_id,auth.uid(),(SELECT display_name FROM public.profiles WHERE id=auth.uid()),p_command,result,to_jsonb(event),after_value);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_competition_relay_checked(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_competition_relay_checked(text,uuid,jsonb) TO authenticated;

DO $$
DECLARE competition text:='3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5'; relay text:='4×300mリレー';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('meet/'||competition,0));
 IF NOT EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=competition AND ready) THEN RAISE EXCEPTION 'meet_pending'; END IF;
 IF EXISTS(SELECT 1 FROM public.competition_meet_events WHERE competition_id=competition AND name=relay AND relay_results IS NULL)
  OR EXISTS(SELECT 1 FROM public.competition_appearances WHERE competition_id=competition AND event_name=relay)
 THEN RAISE EXCEPTION 'meet_relay_existing_individual_data'; END IF;
 INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,sort_order,discipline,wind,capacity,relay_results)
 SELECT competition,relay,relay,'混合','15:30',coalesce(max(sort_order),0)+1,'track',false,6,
  (SELECT jsonb_agg(jsonb_build_object('lane',n,'name','','time','','members',jsonb_build_array('','','','')) ORDER BY n) FROM generate_series(1,6) n)
 FROM public.competition_meet_events WHERE competition_id=competition
 ON CONFLICT(competition_id,name) DO NOTHING;
END $$;
-- Existing event journals and mirror snapshots already include every event column.
NOTIFY pgrst,'reload schema';

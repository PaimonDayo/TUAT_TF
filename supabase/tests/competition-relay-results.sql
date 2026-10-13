-- Synthetic rows only; the caller rolls back the entire migration rehearsal.
CREATE FUNCTION pg_temp.expect_relay_rejection(competition text,command jsonb,expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
  PERFORM public.save_competition_relay_checked(competition,gen_random_uuid(),command);
  RAISE EXCEPTION 'Unexpected relay acceptance';
 EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
  IF SQLERRM IS DISTINCT FROM expected THEN RAISE; END IF;
 END;
END $$;
DO $$
DECLARE actor uuid; other_actor uuid; staff_role uuid:=gen_random_uuid(); participant uuid:=gen_random_uuid();
 competition text:='codex-relay-20261013'; relay text:='4×300mリレー'; teams jsonb; initial jsonb; input jsonb; response jsonb; request uuid:=gen_random_uuid(); backend text; saved jsonb; mirrored jsonb; requests integer;
BEGIN
 SELECT id INTO actor FROM public.profiles WHERE approved AND status='active' LIMIT 1;
 SELECT id INTO other_actor FROM public.profiles WHERE approved AND id<>actor LIMIT 1;
 IF actor IS NULL OR other_actor IS NULL THEN RAISE EXCEPTION 'Relay fixture actors unavailable'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.roles(id,name) VALUES(staff_role,'合成リレー担当');
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(actor,staff_role);
 INSERT INTO public.competitions(id,name,starts_on) VALUES(competition,'合成リレー検証','2026-10-13');
 INSERT INTO public.competition_meets(competition_id,meet_key,staff_role_id,legacy_source,ready) VALUES(competition,competition,staff_role,'ob-2026',true);
 SELECT jsonb_agg(jsonb_build_object('lane',n,'name','','time','','members',jsonb_build_array('','','','')) ORDER BY n) INTO initial FROM generate_series(1,6) n;
 INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,discipline,wind,capacity,relay_results)
 VALUES(competition,relay,relay,'混合','15:30','track',false,6,initial),(competition,'男子100m','100m','男子','11:00','track',true,8,NULL);
 INSERT INTO public.competition_participants(id,competition_id,name,grade) VALUES(participant,competition,'合成個人','B1');
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 backend:=public.get_competition_meet_backend();
 teams:=jsonb_set(jsonb_set(initial,'{0}',jsonb_build_object('lane',1,'name','同名チーム','time','2:45.67','members',jsonb_build_array('合成一走','合成二走','合成三走','合成四走'))),'{5}',jsonb_build_object('lane',6,'name','同名チーム','time','2:44.56','members',jsonb_build_array('別一走','','','')));
 input:=jsonb_build_object('action','relay.save','event',relay,'revision',0,'relayResults',teams,'confirmed',false,'backend',backend);
 response:=public.save_competition_relay_checked(competition,request,input);
 IF response->>'requestId' IS DISTINCT FROM request::text OR response->>'id' IS DISTINCT FROM relay OR (SELECT relay_results FROM public.competition_meet_events WHERE competition_id=competition AND name=relay) IS DISTINCT FROM teams
  OR (SELECT revision FROM public.competition_meet_events WHERE competition_id=competition AND name=relay)<>1 THEN RAISE EXCEPTION 'Six lanes not saved'; END IF;
 IF public.save_competition_relay_checked(competition,request,input) IS DISTINCT FROM response
  OR public.check_competition_meet_mutation(competition,request,input) IS DISTINCT FROM response
  OR (SELECT revision FROM public.competition_meet_events WHERE competition_id=competition AND name=relay)<>1 THEN RAISE EXCEPTION 'Relay request replay duplicated'; END IF;
 teams:=jsonb_set(teams,'{0,time}','"2:46.00"');input:=input||jsonb_build_object('revision',1,'relayResults',teams);
 PERFORM public.save_competition_relay_checked(competition,gen_random_uuid(),input);
 IF (SELECT relay_results->5->>'time' FROM public.competition_meet_events WHERE competition_id=competition AND name=relay)<>'2:44.56' THEN RAISE EXCEPTION 'Other lane changed'; END IF;
 IF (SELECT relay_results->0->'members' FROM public.competition_meet_events WHERE competition_id=competition AND name=relay) IS DISTINCT FROM jsonb_build_array('合成一走','合成二走','合成三走','合成四走') THEN RAISE EXCEPTION 'Relay members lost'; END IF;
 input:=input||'{"revision":2}';
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('relayResults',jsonb_set(teams,'{0,members}','["one"]')),'meet_relay_invalid');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('relayResults',jsonb_set(teams,'{0,members}','[1,"","",""]')),'meet_relay_invalid');
 PERFORM pg_temp.expect_relay_rejection(competition,input||'{"revision":0}','meet_conflict');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('backend',CASE backend WHEN 'pc' THEN 'cloud' ELSE 'pc' END),'meet_backend_changed');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('relayResults',jsonb_set(teams,'{5,lane}','7')),'meet_relay_invalid');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('relayResults',jsonb_set(teams,'{0,time}','"2:99.00"')),'meet_relay_invalid');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('relayResults',jsonb_set(teams,'{0,name}','""')),'meet_relay_invalid');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('confirmed',true,'relayResults',jsonb_set(initial,'{1,name}','"未記録"')),'meet_relay_invalid');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('confirmed',true,'relayResults',initial),'meet_relay_invalid');
 PERFORM public.save_competition_relay_checked(competition,gen_random_uuid(),input||'{"confirmed":true}');
 PERFORM pg_temp.expect_relay_rejection(competition,input||jsonb_build_object('revision',3,'confirmed',false,'relayResults',jsonb_set(teams,'{0,time}','"2:40.00"')),'meet_confirmed');
 PERFORM public.save_competition_relay_checked(competition,gen_random_uuid(),input||'{"revision":3,"confirmed":false}');
 IF (SELECT revision FROM public.competition_meet_events WHERE competition_id=competition AND name=relay)<>4 THEN RAISE EXCEPTION 'Relay confirmation lifecycle'; END IF;
 SELECT count(*) INTO requests FROM public.competition_meet_requests WHERE competition_id=competition;
 IF requests<>4 THEN RAISE EXCEPTION 'Rejected relay request persisted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',other_actor::text,true);
 PERFORM pg_temp.expect_relay_rejection(competition,input||'{"revision":4}','meet_forbidden');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 BEGIN
  PERFORM public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.add','participantId',participant,'event',relay));
  RAISE EXCEPTION 'Individual entered a team relay';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'meet_relay_team' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.competition_appearances WHERE competition_id=competition) OR (SELECT count(*) FROM public.competition_participants WHERE competition_id=competition)<>1 THEN RAISE EXCEPTION 'Fake relay people appeared'; END IF;
 IF public.get_competition_meet(competition)->'events'->1->'relay_results' IS DISTINCT FROM teams THEN
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_competition_meet(competition)->'events') e WHERE e->>'name'=relay AND e->'relay_results'=teams) THEN RAISE EXCEPTION 'Relay missing from read DTO'; END IF;
 END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SELECT to_jsonb(e) INTO saved FROM public.competition_meet_events e WHERE competition_id=competition AND name=relay;
 UPDATE public.competition_meet_events SET relay_results=initial,confirmed=false,revision=0 WHERE competition_id=competition AND name=relay;
 response:=public.replay_competition_meet_changes(jsonb_build_array(jsonb_build_object('id',1,'table_name','competition_meet_events','op','UPDATE','pk',jsonb_build_object('competition_id',competition,'name',relay),'row_data',saved,'changed',jsonb_build_array('relay_results','confirmed','revision'))));
 SELECT to_jsonb(e) INTO mirrored FROM public.competition_meet_events e WHERE competition_id=competition AND name=relay;
 IF response->>'count'<>'1' OR mirrored IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Relay mirror lost lane data'; END IF;
 BEGIN
  PERFORM public.replay_competition_meet_changes(jsonb_build_array(jsonb_build_object('id',1,'table_name','competition_meet_events','op','UPDATE','pk',jsonb_build_object('competition_id',competition,'name',relay),'row_data',jsonb_set(saved,'{relay_results,0,time}','"bad"'),'changed',jsonb_build_array('relay_results'))));
  RAISE EXCEPTION 'Invalid relay mirror accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT relay_results FROM public.competition_meet_events WHERE competition_id=competition AND name=relay) IS DISTINCT FROM teams THEN RAISE EXCEPTION 'Failed mirror partially saved'; END IF;
 IF has_table_privilege('authenticated','public.competition_meet_events','UPDATE') OR has_function_privilege('anon','public.save_competition_relay_checked(text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Relay permission broadened'; END IF;
END $$;
SELECT jsonb_build_object('sixLanes',true,'independentTimes',true,'requestIdempotency',true,'validationAndConfirmation',true,'staffOnly',true,'noFakeParticipants',true,'relayMirror',true);

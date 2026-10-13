-- Run after the new migration in an isolated restored/rehearsal DB as its owner.
-- All synthetic fixtures, requests, and failover journal writes are rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE meet_division_check_init(ok boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.expect_meet_rejection(competition text,request uuid,command jsonb,expected text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 BEGIN
  PERFORM public.mutate_competition_meet(competition,request,command);
  RAISE EXCEPTION 'Unexpectedly accepted: %',expected;
 EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
  IF SQLERRM IS DISTINCT FROM expected THEN RAISE; END IF;
 END;
END $$;

DO $$
DECLARE
 staff uuid; owner_id uuid; role_id uuid:=gen_random_uuid(); person_id uuid:=gen_random_uuid();
 appearance_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
 competition text:='division-check-'||gen_random_uuid(); backend text;
 request_id uuid:=gen_random_uuid(); reverse_request uuid:=gen_random_uuid(); command jsonb; original jsonb; result jsonb;
 baseline public.competition_appearances%ROWTYPE; current_row public.competition_appearances%ROWTYPE;
BEGIN
 SELECT id INTO staff FROM public.profiles WHERE approved ORDER BY id LIMIT 1;
 SELECT id INTO owner_id FROM public.profiles WHERE approved AND id<>staff ORDER BY id LIMIT 1;
 IF staff IS NULL OR owner_id IS NULL THEN RAISE EXCEPTION 'Two approved rehearsal profiles are required'; END IF;
 backend:=CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END;
 IF has_function_privilege('authenticated','public.mutate_competition_meet_base(text,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('anon','public.mutate_competition_meet_base(text,uuid,jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.mutate_competition_meet_base(text,uuid,jsonb)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.mutate_competition_meet(text,uuid,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Mutation dispatch ACLs are incorrect'; END IF;

 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','service_role')::text,true);
 INSERT INTO public.competitions(id,name,starts_on) VALUES(competition,'Division acceptance',current_date);
 INSERT INTO public.roles(id,name) VALUES(role_id,'Division acceptance staff');
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(staff,role_id);
 INSERT INTO public.competition_meets(competition_id,meet_key,staff_role_id,legacy_source,ready)
 VALUES(competition,competition,role_id,'ob-2026',true);
 INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,discipline,wind,capacity)
 VALUES(competition,'男子100m','100m','男子','11:00','track',true,8),
  (competition,'女子100m','100m','女子','11:00','track',true,8),
  (competition,'男子200m','200m','男子','11:00','track',false,8),
  (competition,'男子100m-incompatible','100m','男子','11:00','height',true,8),
  (competition,'混合100m','100m','混合','11:00','track',true,8);
 INSERT INTO public.competition_participants(id,competition_id,profile_id,name,grade)
 VALUES(person_id,competition,owner_id,'Synthetic participant','OB・OG');
 original:=jsonb_build_object('entryId',appearance_id,'group',1,'order',2,'heatScope','男子','status','entered',
  'trials',jsonb_build_array(jsonb_build_object('mark','12.34','wind','+1.0','status','valid')));
 INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,qualification_mark,performance)
 VALUES(appearance_id,competition,person_id,'男子100m',1,person_id::text,'12.50',original),
  (other_id,competition,person_id,'女子100m',1,person_id::text,'13.50',
   jsonb_build_object('entryId',other_id,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
 SELECT * INTO baseline FROM public.competition_appearances WHERE id=appearance_id;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);

 command:=jsonb_build_object('action','appearance.moveDivision','id',appearance_id,'revision',0,'event','女子100m','backend',backend);
 result:=public.mutate_competition_meet(competition,request_id,command);
 SELECT * INTO current_row FROM public.competition_appearances WHERE id=appearance_id;
 IF current_row.id<>baseline.id OR current_row.participant_id<>baseline.participant_id OR current_row.event_name<>'女子100m'
  OR current_row.ordinal<>2 OR current_row.revision<>1 OR current_row.operation_key<>appearance_id::text
  OR current_row.qualification_mark IS DISTINCT FROM baseline.qualification_mark OR current_row.state<>baseline.state
  OR current_row.performance IS DISTINCT FROM (original-'heatScope')||jsonb_build_object('group',NULL,'order',NULL)
 THEN RAISE EXCEPTION 'Division correction lost data, left placement, or collided with a destination appearance'; END IF;
 IF result->>'id'<>appearance_id::text OR result->>'requestId'<>request_id::text
  OR (SELECT count(*) FROM public.competition_meet_events WHERE competition_id=competition AND name IN ('男子100m','女子100m') AND revision=1)<>2
  OR NOT EXISTS(SELECT 1 FROM public.competition_meet_requests WHERE id=request_id AND before_data=to_jsonb(baseline) AND after_data=to_jsonb(current_row))
 THEN RAISE EXCEPTION 'Request result, event revisions, or audit snapshots were lost'; END IF;
 IF public.mutate_competition_meet(competition,request_id,command) IS DISTINCT FROM result
  OR public.check_competition_meet_mutation(competition,request_id,command) IS DISTINCT FROM result
  OR (SELECT revision FROM public.competition_appearances WHERE id=appearance_id)<>1
  OR (SELECT count(*) FROM public.competition_meet_requests WHERE id=request_id)<>1
 THEN RAISE EXCEPTION 'Request replay was not idempotent'; END IF;
 IF public.check_competition_meet_mutation(competition,gen_random_uuid(),command)->>'notSaved' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Unknown request could not be distinguished from a saved request'; END IF;
 PERFORM pg_temp.expect_meet_rejection(competition,request_id,command||jsonb_build_object('mark','13.00'),'meet_request');
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('event','男子100m'),'meet_conflict');
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m','backend',CASE backend WHEN 'pc' THEN 'cloud' ELSE 'pc' END),'meet_backend_changed');
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子200m'),'meet_division');
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m-incompatible'),'meet_division');
 UPDATE public.competition_meet_events SET discipline='track',wind=false
 WHERE competition_id=competition AND name='男子100m-incompatible';
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m-incompatible'),'meet_division');
 UPDATE public.competition_meet_events SET wind=true,capacity=7
 WHERE competition_id=competition AND name='男子100m-incompatible';
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m-incompatible'),'meet_division');
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','混合100m'),'meet_division');
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m','mark',repeat('x',1001)),'meet_invalid');

 UPDATE public.competition_meet_events SET confirmed=true WHERE competition_id=competition AND name='女子100m';
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m'),'meet_confirmed');
 UPDATE public.competition_meet_events SET confirmed=false WHERE competition_id=competition AND name='女子100m';
 UPDATE public.competition_meet_events SET confirmed=true WHERE competition_id=competition AND name='男子100m';
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m'),'meet_confirmed');
 UPDATE public.competition_meet_events SET confirmed=false WHERE competition_id=competition AND name='男子100m';

 -- Even a participant's owner cannot bypass the current OB staff-only ledger guard.
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 PERFORM pg_temp.expect_meet_rejection(competition,gen_random_uuid(),command||jsonb_build_object('revision',1,'event','男子100m'),'meet_forbidden');
 IF (SELECT to_jsonb(a) FROM public.competition_appearances a WHERE id=appearance_id) IS DISTINCT FROM to_jsonb(current_row)
  OR (SELECT count(*) FROM public.competition_meet_events WHERE competition_id=competition AND name IN ('男子100m','女子100m') AND revision=1)<>2
 THEN RAISE EXCEPTION 'Rejected OB write was only partially rolled back'; END IF;
 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);

 -- An optional qualification correction belongs to the same atomic request.
 PERFORM public.mutate_competition_meet(competition,reverse_request,command||jsonb_build_object('revision',1,'event','男子100m','mark','13.00'));
 IF NOT EXISTS(SELECT 1 FROM public.competition_appearances WHERE id=appearance_id AND event_name='男子100m'
  AND revision=2 AND ordinal=1 AND operation_key=appearance_id::text
  AND qualification_mark='13.00' AND performance->'trials'=original->'trials')
 THEN RAISE EXCEPTION 'Reverse correction lost the simultaneous qualification edit'; END IF;
 -- The wrapper still delegates the existing qualification-only action.
 PERFORM public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.edit',
  'id',appearance_id,'revision',2,'mark','14.00','backend',backend));
 IF NOT EXISTS(SELECT 1 FROM public.competition_appearances WHERE id=appearance_id AND revision=3 AND qualification_mark='14.00')
 THEN RAISE EXCEPTION 'Existing mutation delegation failed'; END IF;

 UPDATE public.competition_appearances SET state='cancelled',performance=performance||jsonb_build_object('status','DNS') WHERE id=appearance_id;
 PERFORM public.mutate_competition_meet(competition,gen_random_uuid(),command||jsonb_build_object('revision',3,'mark',NULL));
 IF NOT EXISTS(SELECT 1 FROM public.competition_appearances WHERE id=appearance_id AND event_name='女子100m' AND revision=4
  AND ordinal=2 AND operation_key=appearance_id::text
  AND state='cancelled' AND performance->>'status'='DNS' AND performance->'trials'=original->'trials' AND qualification_mark IS NULL)
 THEN RAISE EXCEPTION 'Cancelled/DNS correction lost its saved state or explicit qualification clearing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.competition_appearances WHERE id=other_id AND ordinal=1 AND revision=0 AND qualification_mark='13.50')
 THEN RAISE EXCEPTION 'An unrelated destination appearance changed'; END IF;

 RAISE NOTICE 'Division correction acceptance passed (synthetic data; rollback follows)';
END $$;
ROLLBACK;

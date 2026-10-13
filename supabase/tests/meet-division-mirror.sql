-- Run as the owner only in an isolated restored/rehearsal DB after both division
-- migrations. All fixtures, mutation requests, and journals are rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE meet_division_mirror_init(ok boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.meet_mirror_row(sequence integer,target text,pk jsonb,row_data jsonb) RETURNS jsonb
LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',sequence,'table_name',target,'op','UPDATE','pk',pk,'row_data',row_data,
  'changed',(SELECT jsonb_agg(name) FROM jsonb_object_keys(row_data) name WHERE NOT pk?name))
$$;
CREATE FUNCTION pg_temp.expect_meet_mirror_duplicate(rows jsonb,expected_constraint text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE rejected_constraint text;
BEGIN
 BEGIN
  PERFORM public.replay_competition_meet_changes(rows);
  RAISE EXCEPTION 'A duplicate mirror batch returned success';
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME;
  IF rejected_constraint IS DISTINCT FROM expected_constraint THEN RAISE; END IF;
 END;
END $$;

DO $$
DECLARE
 staff uuid; role_id uuid:=gen_random_uuid(); competition text:='division-mirror-'||gen_random_uuid(); backend text;
 owner_role text:=current_user; caller_role text; result jsonb; row_data jsonb; batch jsonb; before_rows jsonb; before_event jsonb;
 pair_person uuid:=gen_random_uuid(); pair_a uuid:=gen_random_uuid(); pair_b uuid:=gen_random_uuid();
 pair_before_a public.competition_appearances%ROWTYPE; pair_before_b public.competition_appearances%ROWTYPE;
 pair_after_a public.competition_appearances%ROWTYPE; pair_after_b public.competition_appearances%ROWTYPE;
 add_person uuid:=gen_random_uuid(); add_original uuid:=gen_random_uuid(); added_id uuid;
 add_before public.competition_appearances%ROWTYPE; add_after public.competition_appearances%ROWTYPE; added public.competition_appearances%ROWTYPE;
 normal_added_id uuid; rejected_constraint text;
BEGIN
 SELECT id INTO staff FROM public.profiles WHERE approved ORDER BY id LIMIT 1;
 IF staff IS NULL THEN RAISE EXCEPTION 'An approved rehearsal profile is required'; END IF;
 backend:=CASE WHEN coalesce((SELECT log_changes FROM public.failover_config WHERE id),false) THEN 'cloud' ELSE 'pc' END;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid='public.competition_appearances'::regclass
  AND conname IN ('competition_appearance_event_operation_key','competition_appearance_participant_event_ordinal')
  AND contype='u' AND condeferrable AND NOT condeferred)<>2
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.competition_appearances'::regclass
   AND contype='p' AND NOT condeferrable)
 THEN RAISE EXCEPTION 'Appearance constraint timing or the ID PK changed'; END IF;
 IF strpos(pg_get_functiondef('public.refresh_competition_meet_import(boolean,text)'::regprocedure),
  'FROM dedup s JOIN public.competition_participants p ON p.id=s.participant_id JOIN public.competition_meet_events e ON e.competition_id=s.competition_id AND e.name=s.event_name ON CONFLICT(id) DO NOTHING;')=0
 THEN RAISE EXCEPTION 'Import did not select the immediate appearance ID arbiter'; END IF;
 IF has_function_privilege('anon','public.replay_competition_meet_changes(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.replay_competition_meet_changes(jsonb)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.replay_competition_meet_changes(jsonb)','EXECUTE')
  OR has_function_privilege('anon','public.replay_competition_meet_changes_base(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.replay_competition_meet_changes_base(jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.replay_competition_meet_changes_base(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Mirror dispatcher ACLs are incorrect'; END IF;
 FOREACH caller_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  BEGIN
   EXECUTE format('SET LOCAL ROLE %I',caller_role);
   PERFORM public.replay_competition_meet_changes('[]'::jsonb);
   RAISE EXCEPTION 'A non-service caller could execute mirror replay';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF current_user<>owner_role THEN RAISE EXCEPTION 'Rejected replay did not restore its caller role'; END IF;
 END LOOP;

 PERFORM set_config('request.jwt.claim.sub',staff::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','service_role')::text,true);
 INSERT INTO public.competitions(id,name,starts_on) VALUES(competition,'Division mirror acceptance',current_date);
 INSERT INTO public.roles(id,name) VALUES(role_id,'Division mirror staff '||role_id);
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(staff,role_id);
 INSERT INTO public.competition_meets(competition_id,meet_key,staff_role_id,legacy_source,ready)
 VALUES(competition,competition,role_id,'ob-2026',true);
 INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,discipline,wind,capacity)
 VALUES(competition,'男子100m','100m','男子','11:00','track',true,8),
  (competition,'女子100m','100m','女子','11:00','track',true,8);
 INSERT INTO public.competition_participants(id,competition_id,name,grade)
 VALUES(pair_person,competition,'Opposite correction fixture','OB・OG'),
  (add_person,competition,'Add after correction fixture','OB・OG');
 INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,performance)
 VALUES(pair_a,competition,pair_person,'男子100m',1,pair_person::text,
   jsonb_build_object('entryId',pair_a,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb)),
  (pair_b,competition,pair_person,'女子100m',1,pair_person::text,
   jsonb_build_object('entryId',pair_b,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb)),
  (add_original,competition,add_person,'男子100m',1,add_person::text,
   jsonb_build_object('entryId',add_original,'group',NULL,'order',NULL,'status','entered','trials','[]'::jsonb));
 SELECT * INTO pair_before_a FROM public.competition_appearances WHERE id=pair_a;
 SELECT * INTO pair_before_b FROM public.competition_appearances WHERE id=pair_b;
 SELECT * INTO add_before FROM public.competition_appearances WHERE id=add_original;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);

 -- Capture a valid canonical state, restore the old mirror rows, then apply the
 -- final opposite moves in the order which still has A occupying B's target.
 PERFORM public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.moveDivision',
  'id',pair_a,'revision',0,'event','女子100m','backend',backend));
 PERFORM public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.moveDivision',
  'id',pair_b,'revision',0,'event','男子100m','backend',backend));
 SELECT * INTO pair_after_a FROM public.competition_appearances WHERE id=pair_a;
 SELECT * INTO pair_after_b FROM public.competition_appearances WHERE id=pair_b;
 DELETE FROM public.competition_appearances WHERE id IN (pair_a,pair_b);
 INSERT INTO public.competition_appearances SELECT (pair_before_a).*;
 INSERT INTO public.competition_appearances SELECT (pair_before_b).*;
 batch:=jsonb_build_array(
  pg_temp.meet_mirror_row(1,'competition_appearances',jsonb_build_object('id',pair_b),to_jsonb(pair_after_b)),
  pg_temp.meet_mirror_row(2,'competition_appearances',jsonb_build_object('id',pair_a),to_jsonb(pair_after_a)));
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','service_role')::text,true);
 EXECUTE 'SET LOCAL ROLE service_role';
 result:=public.replay_competition_meet_changes(batch);
 EXECUTE format('SET LOCAL ROLE %I',owner_role);
 IF result->>'count'<>'2'
  OR (SELECT to_jsonb(a) FROM public.competition_appearances a WHERE id=pair_a) IS DISTINCT FROM to_jsonb(pair_after_a)
  OR (SELECT to_jsonb(a) FROM public.competition_appearances a WHERE id=pair_b) IS DISTINCT FROM to_jsonb(pair_after_b)
 THEN RAISE EXCEPTION 'Opposite division snapshot could not replay in reverse order'; END IF;

 -- A new registration reuses ordinal 1 in the vacated event. A mirror may see
 -- that new row first; its ON CONFLICT(id) insertion must also permit the batch.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 PERFORM public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.moveDivision',
  'id',add_original,'revision',0,'event','女子100m','backend',backend));
 result:=public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.add',
  'participantId',add_person,'event','男子100m','backend',backend));
 added_id:=(result->>'id')::uuid;
 SELECT * INTO add_after FROM public.competition_appearances WHERE id=add_original;
 SELECT * INTO added FROM public.competition_appearances WHERE id=added_id;
 IF added.ordinal<>1 THEN RAISE EXCEPTION 'The add fixture did not reuse the vacated ordinal'; END IF;
 DELETE FROM public.competition_appearances WHERE id IN (add_original,added_id);
 INSERT INTO public.competition_appearances SELECT (add_before).*;
 result:=public.replay_competition_meet_changes(jsonb_build_array(
  pg_temp.meet_mirror_row(1,'competition_appearances',jsonb_build_object('id',added_id),to_jsonb(added)),
  pg_temp.meet_mirror_row(2,'competition_appearances',jsonb_build_object('id',add_original),to_jsonb(add_after))));
 IF result->>'count'<>'2'
  OR (SELECT to_jsonb(a) FROM public.competition_appearances a WHERE id=add_original) IS DISTINCT FROM to_jsonb(add_after)
  OR (SELECT to_jsonb(a) FROM public.competition_appearances a WHERE id=added_id) IS DISTINCT FROM to_jsonb(added)
 THEN RAISE EXCEPTION 'New registration could not precede its division correction in the snapshot'; END IF;

 -- A genuinely invalid final ordinal/key must fail inside the RPC and roll
 -- back earlier event writes, rather than returning a count before commit.
 SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO before_rows FROM public.competition_appearances a WHERE competition_id=competition;
 SELECT to_jsonb(e) INTO before_event FROM public.competition_meet_events e WHERE competition_id=competition AND name='男子100m';
 row_data:=to_jsonb(pair_after_a)||jsonb_build_object('event_name',pair_after_b.event_name,'ordinal',pair_after_b.ordinal,'operation_key','ordinal-duplicate-'||pair_a);
 batch:=jsonb_build_array(
  pg_temp.meet_mirror_row(1,'competition_meet_events',jsonb_build_object('competition_id',competition,'name','男子100m'),
   before_event||jsonb_build_object('revision',(before_event->>'revision')::integer+7)),
  pg_temp.meet_mirror_row(2,'competition_appearances',jsonb_build_object('id',pair_a),row_data));
 PERFORM pg_temp.expect_meet_mirror_duplicate(batch,'competition_appearance_participant_event_ordinal');
 IF (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.competition_appearances a WHERE competition_id=competition) IS DISTINCT FROM before_rows
  OR (SELECT to_jsonb(e) FROM public.competition_meet_events e WHERE competition_id=competition AND name='男子100m') IS DISTINCT FROM before_event
 THEN RAISE EXCEPTION 'A rejected ordinal batch was partially saved'; END IF;
 row_data:=to_jsonb(pair_after_a)||jsonb_build_object('event_name',pair_after_b.event_name,'ordinal',pair_after_b.ordinal+100,'operation_key',pair_after_b.operation_key);
 batch:=jsonb_set(batch,'{1,row_data}',row_data);
 PERFORM pg_temp.expect_meet_mirror_duplicate(batch,'competition_appearance_event_operation_key');
 IF (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.competition_appearances a WHERE competition_id=competition) IS DISTINCT FROM before_rows
  OR (SELECT to_jsonb(e) FROM public.competition_meet_events e WHERE competition_id=competition AND name='男子100m') IS DISTINCT FROM before_event
 THEN RAISE EXCEPTION 'A rejected key batch was partially saved'; END IF;

 -- Ordinary adds remain usable and both constraints are immediately checked
 -- after a successful or rejected replay in this same transaction.
 result:=public.mutate_competition_meet(competition,gen_random_uuid(),jsonb_build_object('action','appearance.add',
  'participantId',add_person,'event','男子100m','backend',backend));
 normal_added_id:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.competition_appearances WHERE id=normal_added_id AND ordinal=2)
 THEN RAISE EXCEPTION 'Normal appearance registration failed after replay'; END IF;
 BEGIN
  INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,performance)
  VALUES(gen_random_uuid(),competition,add_person,'男子100m',added.ordinal,'immediate-ordinal-check',added.performance);
  RAISE EXCEPTION 'Normal ordinal uniqueness was left deferred';
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME;
  IF rejected_constraint<>'competition_appearance_participant_event_ordinal' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,performance)
  VALUES(gen_random_uuid(),competition,add_person,'男子100m',100,added.operation_key,added.performance);
  RAISE EXCEPTION 'Normal operation-key uniqueness was left deferred';
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS rejected_constraint=CONSTRAINT_NAME;
  IF rejected_constraint<>'competition_appearance_event_operation_key' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
\echo 'Division snapshot replay order, final duplicate rollback, immediate registration constraints, and RPC ACLs: PASS'

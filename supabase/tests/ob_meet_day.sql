-- Run with psql -X -v ON_ERROR_STOP=1 after the current migrations, as the migration owner.
-- Regression fixtures use generated account, role and entrant IDs; no live IDs or user data.
-- RPCs may touch the existing OB event aggregate inside this transaction only.
-- ALWAYS keep ROLLBACK. A failed assertion must terminate the connection without committing.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Run only inside a transaction ending ROLLBACK, after the migration.
-- Synthetic names/UUIDs are generated per run. No participant details are emitted.
DO $test$
DECLARE actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); sysactor uuid:=gen_random_uuid(); system_role uuid; staff_role uuid;
 suffix text:=gen_random_uuid()::text; event text:='男子1500m'; owner_role text:=current_user;
 request uuid:=gen_random_uuid(); a uuid; b uuid; c uuid; d uuid; new_id uuid; rev integer;
 first_result jsonb; retry_result jsonb; saved jsonb; base_data jsonb; draft jsonb; latest jsonb; before_attendance jsonb; after_attendance jsonb;
 before_count integer; audit_count integer; marker text; detail text; role_uuid uuid:=gen_random_uuid(); role_time text; role_event text;
 linked_entry public.ob_meet_entries%ROWTYPE; linked_revision integer; linked_roles uuid[]; status_test text;
 attempted_role uuid:=gen_random_uuid(); attempted_time text; attempted_event text;
BEGIN
 -- All accounts/role memberships referenced below are synthetic and transaction-local.
 INSERT INTO auth.users(id,email) SELECT id,'ob-day-'||id||'@example.invalid' FROM unnest(ARRAY[actor,outsider,sysactor]) id;
 INSERT INTO public.profiles(id,email,display_name,blocks,grade,status,approved)
 SELECT id,'ob-day-'||id||'@example.invalid','__ob_day_person_'||id,'{}','1','active',true FROM unnest(ARRAY[actor,outsider,sysactor]) id
 ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,blocks=excluded.blocks,grade=excluded.grade,status=excluded.status,approved=excluded.approved;
 DELETE FROM public.profile_roles WHERE profile_id=ANY(ARRAY[actor,outsider,sysactor]);
 SELECT id INTO staff_role FROM public.roles WHERE name='OB戦2026';
 IF staff_role IS NULL THEN RAISE EXCEPTION 'OB staff role migration missing'; END IF;
 SELECT id INTO system_role FROM public.roles WHERE can_manage_system AND name<>'OB戦2026' ORDER BY id LIMIT 1;
 IF system_role IS NULL THEN RAISE EXCEPTION 'system permission role migration missing'; END IF;
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(actor,staff_role),(sysactor,system_role);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 IF NOT public.can_manage_ob_meet() OR public.can_manage_system() THEN RAISE EXCEPTION 'staff-only fixture is not isolated'; END IF;
 PERFORM public.save_ob_entry(NULL,actor,NULL,ARRAY['男子100m'],'{}');
 SELECT to_jsonb(o) INTO latest FROM public.ob_event_operations o WHERE meet_key='ob-2026' AND event_name=event;
 IF coalesce((latest->'data'->>'confirmed')::boolean,false) THEN
  PERFORM public.save_ob_event_operation(event,(latest->>'revision')::integer,jsonb_set(latest->'data','{confirmed}','false'::jsonb));
 END IF;
 -- Test groups are outside normal grouping. Existing event rows are retained in the transaction.
 first_result:=public.add_ob_day_entry(request,event,NULL,NULL,'__ob_day_a_'||suffix,'B1',98);
 a:=(first_result->>'entryId')::uuid;
 retry_result:=public.add_ob_day_entry(request,event,NULL,NULL,'__ob_day_a_'||suffix,'B1',98);
 IF first_result->>'entryId' IS DISTINCT FROM retry_result->>'entryId' OR first_result->'saved'->'revision' IS DISTINCT FROM retry_result->'saved'->'revision'
  THEN RAISE EXCEPTION 'FAIL idempotent retry changed operation'; END IF;
 SELECT count(*) INTO before_count FROM public.ob_meet_entries;
 BEGIN
  PERFORM public.add_ob_day_entry(gen_random_uuid(),event,NULL,NULL,'__ob_day_a_'||suffix,'B1',98);
  RAISE EXCEPTION 'FAIL duplicate was accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_duplicate%' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.ob_meet_entries)<>before_count THEN RAISE EXCEPTION 'FAIL duplicate leaked registration'; END IF;
 -- A cancelled lane number remains reserved.
 latest:=first_result->'saved'; base_data:=latest->'data';
 SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=a::text THEN value||'{"status":"DNS"}'::jsonb ELSE value END ORDER BY ordinal))
 INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
 saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
 retry_result:=public.add_ob_day_entry(gen_random_uuid(),event,NULL,NULL,'__ob_day_b_'||suffix,'B1',98);
 b:=(retry_result->>'entryId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(retry_result->'saved'->'data'->'participants') p WHERE p->>'entryId'=b::text AND p->>'order'='2')
 THEN RAISE EXCEPTION 'FAIL DNS number reused'; END IF;
 -- Existing registration keeps unrelated events/qualifying marks and gets atomically placed.
 c:=public.create_ob_guest_registration('__ob_day_c_'||suffix,'B1',ARRAY['男子100m'],'{"男子100m":"11.50"}','未回答',NULL,NULL);
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=c;
 retry_result:=public.add_ob_day_entry(gen_random_uuid(),event,c,rev,NULL,NULL,97);
 IF NOT EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE id=c AND events@>ARRAY[event,'男子100m'] AND qualification_marks->>'男子100m'='11.50')
 THEN RAISE EXCEPTION 'FAIL unrelated entry was overwritten'; END IF;
 latest:=retry_result->'saved'; base_data:=latest->'data';
 -- Independent people and independent fields on the same person merge.
 SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=b::text THEN value||'{"trials":[{"mark":"240.00","status":"valid","wind":""}]}'::jsonb ELSE value END ORDER BY ordinal))
 INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
 saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
 SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=c::text THEN value||'{"trials":[{"mark":"241.00","status":"valid","wind":""}]}'::jsonb
  WHEN value->>'entryId'=b::text THEN value||'{"group":96,"order":1}'::jsonb ELSE value END ORDER BY ordinal))
 INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
 saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(saved->'data'->'participants') p WHERE p->>'entryId'=b::text AND p->>'group'='96' AND p->'trials'->0->>'mark'='240.00')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(saved->'data'->'participants') p WHERE p->>'entryId'=c::text AND p->'trials'->0->>'mark'='241.00')
 THEN RAISE EXCEPTION 'FAIL disjoint merge lost changes'; END IF;
 SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=b::text THEN value||'{"trials":[{"mark":"242.00","status":"valid","wind":""}]}'::jsonb ELSE value END ORDER BY ordinal))
 INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
 BEGIN
  PERFORM public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
  RAISE EXCEPTION 'FAIL divergent mark was accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%operation_conflict%' THEN RAISE; END IF;
  GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
  IF detail::jsonb->'revision' IS DISTINCT FROM saved->'revision' THEN RAISE EXCEPTION 'FAIL conflict latest missing'; END IF;
 END;
 -- Started-group rejection rolls back registration/party/history as one unit.
 SELECT count(*) INTO before_count FROM public.ob_meet_entries;
 BEGIN
  PERFORM public.add_ob_day_entry(gen_random_uuid(),event,NULL,NULL,'__ob_day_rejected_'||suffix,'B1',96);
  RAISE EXCEPTION 'FAIL started group accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%operation_started%' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.ob_meet_entries)<>before_count THEN RAISE EXCEPTION 'FAIL rejected addition leaked'; END IF;
 -- DNF/DQ are already-run groups even if no numeric result was entered.
 FOREACH status_test IN ARRAY ARRAY['DNF','DQ'] LOOP
  latest:=saved; base_data:=latest->'data';
  SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=a::text THEN value||jsonb_build_object('status',status_test) ELSE value END ORDER BY ordinal))
   INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
  saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
  BEGIN
   PERFORM public.add_ob_day_entry(gen_random_uuid(),event,NULL,NULL,'__ob_day_'||status_test||'_'||suffix,'B1',98);
   RAISE EXCEPTION 'FAIL DNF/DQ group accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%operation_started%' THEN RAISE; END IF; END;
 END LOOP;
 -- New entries arriving during a draft are added unassigned without disturbing old marks.
 d:=public.create_ob_guest_registration('__ob_day_d_'||suffix,'B1',ARRAY[event],'{}','未回答',NULL,NULL);
 saved:=public.save_ob_event_operation_checked(event,(saved->>'revision')::integer,saved->'data',saved->'data');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(saved->'data'->'participants') p WHERE p->>'entryId'=d::text AND p->'group'='null'::jsonb AND p->'trials'='[]'::jsonb)
 THEN RAISE EXCEPTION 'FAIL new roster reconciliation'; END IF;
 -- Existing helper assignments survive absence, additions are blocked and removals permitted.
 SELECT slot_time,event_name INTO role_time,role_event FROM public.ob_duty_event_slots WHERE event_name='走り高跳び' LIMIT 1;
 INSERT INTO public.ob_duty_roles(id,slot_time,event_name,name,abbreviation,required_count) VALUES(role_uuid,role_time,role_event,'__ob_day_role_'||suffix,'試験',2);
 rev:=public.save_ob_entry_duty_roles(d,role_time,role_event,ARRAY[role_uuid],NULL);
 SELECT to_jsonb(e)-'revision'-'absent' INTO before_attendance FROM public.ob_meet_entries e WHERE id=d;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=d;
 SELECT count(*) INTO audit_count FROM public.ob_entry_changes WHERE entry_id=d;
 retry_result:=public.set_ob_attendance(d,rev,true);
 IF NOT EXISTS(SELECT 1 FROM public.ob_entry_duties WHERE entry_id=d AND role_uuid=ANY(role_ids))
  OR (SELECT count(*) FROM public.ob_entry_changes WHERE entry_id=d)<>audit_count+1 THEN RAISE EXCEPTION 'FAIL absence lost duty or audit'; END IF;
 IF public.set_ob_attendance(d,rev,true) IS DISTINCT FROM retry_result
  OR (SELECT count(*) FROM public.ob_entry_changes WHERE entry_id=d)<>audit_count+1 THEN RAISE EXCEPTION 'FAIL attendance retry wrote again'; END IF;
 BEGIN
  PERFORM public.set_ob_attendance(d,rev,false);
  RAISE EXCEPTION 'FAIL attendance stale opposite state accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_conflict%' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.set_ob_attendance(d,rev+99,true);
  RAISE EXCEPTION 'FAIL attendance future revision accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_conflict%' THEN RAISE; END IF; END;
 SELECT to_jsonb(e)-'revision'-'absent' INTO after_attendance FROM public.ob_meet_entries e WHERE id=d;
 IF before_attendance IS DISTINCT FROM after_attendance THEN RAISE EXCEPTION 'FAIL absence changed registration'; END IF;
 SELECT revision INTO rev FROM public.ob_entry_duties WHERE entry_id=d AND slot_time=role_time AND event_name=role_event;
 PERFORM public.save_ob_entry_duty_roles(d,role_time,role_event,'{}',rev);
 SELECT revision INTO rev FROM public.ob_entry_duties WHERE entry_id=d AND slot_time=role_time AND event_name=role_event;
 BEGIN
  PERFORM public.save_ob_entry_duty_roles(d,role_time,role_event,ARRAY[role_uuid],rev);
  RAISE EXCEPTION 'FAIL absent helper accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_absent%' THEN RAISE; END IF; END;
 -- Old profile-based helper editors delegate to the same absence guard.
 SELECT * INTO linked_entry FROM public.ob_meet_entries WHERE meet_key='ob-2026' AND profile_id=actor;
 IF linked_entry.id IS NULL THEN RAISE EXCEPTION 'synthetic linked entry missing'; END IF;
 PERFORM public.set_ob_attendance(linked_entry.id,linked_entry.revision,true);
 SELECT revision,role_ids INTO linked_revision,linked_roles FROM public.ob_meet_duties
  WHERE profile_id=linked_entry.profile_id AND slot_time=role_time AND event_name=role_event;
 BEGIN
  PERFORM public.save_ob_duty_roles(linked_entry.profile_id,role_time,role_event,array_append(coalesce(linked_roles,'{}'),role_uuid),linked_revision);
  RAISE EXCEPTION 'FAIL absent legacy helper accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_absent%' THEN RAISE; END IF; END;
 PERFORM public.save_ob_duty_roles(linked_entry.profile_id,role_time,role_event,'{}',linked_revision);
 IF has_function_privilege('authenticated','public.save_ob_duty(uuid,text,text,integer,text)','EXECUTE')
  THEN RAISE EXCEPTION 'FAIL deprecated unrestricted helper RPC exposed'; END IF;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=d;
 BEGIN
  PERFORM public.add_ob_day_entry(gen_random_uuid(),event,d,rev,NULL,NULL,NULL);
  RAISE EXCEPTION 'FAIL absent registration accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_absent%' THEN RAISE; END IF; END;
 latest:=saved; base_data:=latest->'data';
 SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=d::text THEN value||'{"group":95,"order":1}'::jsonb ELSE value END ORDER BY ordinal))
 INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
 BEGIN
  PERFORM public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
  RAISE EXCEPTION 'FAIL absent competitor resumed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%operation_absent%' THEN RAISE; END IF; END;
 -- Explicit attendance restoration permits the same edit.
 PERFORM public.set_ob_attendance(d,rev,false);
 saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
 -- Removing registration keeps past performance; the occupied time still prevents a new duty.
 SELECT slot_time,event_name INTO attempted_time,attempted_event FROM public.ob_duty_event_slots WHERE event_name='1500m' LIMIT 1;
 INSERT INTO public.ob_duty_roles(id,slot_time,event_name,name,abbreviation,required_count)
 VALUES(attempted_role,attempted_time,attempted_event,'__ob_day_attempted_'||suffix,'試験',2);
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=c;
 PERFORM public.save_ob_entry(c,NULL,rev,ARRAY['男子100m'],'{"男子100m":"11.50"}');
 BEGIN
  PERFORM public.save_ob_entry_duty_roles(c,attempted_time,attempted_event,ARRAY[attempted_role],NULL);
  RAISE EXCEPTION 'FAIL recorded cancelled competitor assigned duty';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_competing%' THEN RAISE; END IF; END;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=a;
 PERFORM public.save_ob_entry(a,NULL,rev,'{}','{}');
 FOREACH status_test IN ARRAY ARRAY['DNF','DQ'] LOOP
  latest:=saved; base_data:=latest->'data';
  SELECT jsonb_set(base_data,'{participants}',jsonb_agg(CASE WHEN value->>'entryId'=a::text THEN value||jsonb_build_object('status',status_test) ELSE value END ORDER BY ordinal))
   INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
  saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
  BEGIN
   PERFORM public.save_ob_entry_duty_roles(a,attempted_time,attempted_event,ARRAY[attempted_role],NULL);
   RAISE EXCEPTION 'FAIL DNF/DQ cancelled competitor assigned duty';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%entry_competing%' THEN RAISE; END IF; END;
 END LOOP;
 -- A cancelled empty placeholder does not occupy competition time forever.
 new_id:=public.create_ob_guest_registration('__ob_day_cancel_empty_'||suffix,'B1',ARRAY[event],'{}','未回答',NULL,NULL);
 saved:=public.save_ob_event_operation_checked(event,(saved->>'revision')::integer,saved->'data',saved->'data');
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=new_id;
 PERFORM public.save_ob_entry(new_id,NULL,rev,'{}','{}');
 PERFORM public.save_ob_entry_duty_roles(new_id,attempted_time,attempted_event,ARRAY[attempted_role],NULL);
 -- A confirmed event rejects an addition before creating any entry.
 latest:=saved; base_data:=latest->'data';
 SELECT jsonb_build_object('confirmed',true,'participants',jsonb_agg(value||'{"status":"DNS"}'::jsonb ORDER BY ordinal))
 INTO draft FROM jsonb_array_elements(base_data->'participants') WITH ORDINALITY x(value,ordinal);
 saved:=public.save_ob_event_operation_checked(event,(latest->>'revision')::integer,draft,base_data);
 SELECT count(*) INTO before_count FROM public.ob_meet_entries;
 BEGIN
  PERFORM public.add_ob_day_entry(gen_random_uuid(),event,NULL,NULL,'__ob_day_confirmed_'||suffix,'B1',NULL);
  RAISE EXCEPTION 'FAIL confirmed event accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%operation_confirmed%' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.ob_meet_entries)<>before_count THEN RAISE EXCEPTION 'FAIL confirmed rejection leaked entry'; END IF;
 -- Staff use the checked attendance RPC. Table/column grants prevent a direct bypass.
 IF has_column_privilege('authenticated','public.ob_meet_entries','absent','UPDATE')
  THEN RAISE EXCEPTION 'FAIL direct attendance UPDATE privilege'; END IF;
 BEGIN
  SET LOCAL ROLE authenticated;
  UPDATE public.ob_meet_entries SET absent=true WHERE id=d;
  RAISE EXCEPTION 'FAIL direct attendance UPDATE succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('role',owner_role,true);
 -- Ordinary members cannot mutate operations, another entrant's attendance, or day registration.
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 IF public.can_manage_ob_meet() OR public.can_manage_system() THEN RAISE EXCEPTION 'ordinary fixture is not isolated'; END IF;
 BEGIN PERFORM public.set_ob_attendance(d,rev,true); RAISE EXCEPTION 'FAIL ordinary attendance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.add_ob_day_entry(gen_random_uuid(),event,d,rev,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL ordinary registration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.save_ob_event_operation_checked(event,(saved->>'revision')::integer,saved->'data',saved->'data'); RAISE EXCEPTION 'FAIL ordinary operation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- System-only operators can save event results, but do not gain registration/attendance rights.
 PERFORM set_config('request.jwt.claim.sub',sysactor::text,true);
 IF public.can_manage_ob_meet() OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'system-only fixture is not isolated'; END IF;
 saved:=public.save_ob_event_operation_checked(event,(saved->>'revision')::integer,saved->'data',saved->'data');
 BEGIN PERFORM public.set_ob_attendance(d,rev,true); RAISE EXCEPTION 'FAIL system-only attendance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.add_ob_day_entry(gen_random_uuid(),event,d,rev,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL system-only registration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Anonymous cannot call any mutation (even from a SQL owner connection with empty claims).
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.set_ob_attendance(d,rev,true); RAISE EXCEPTION 'FAIL anonymous attendance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.add_ob_day_entry(gen_random_uuid(),event,d,rev,NULL,NULL,NULL); RAISE EXCEPTION 'FAIL anonymous registration'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.save_ob_event_operation_checked(event,(saved->>'revision')::integer,saved->'data',saved->'data'); RAISE EXCEPTION 'FAIL anonymous operation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END $test$;
SELECT jsonb_build_object('ob_day_checks','passed','cases',ARRAY['idempotent retry','duplicate rollback','DNS number reservation','existing event+marks preservation','different person+field merge','same-field conflict+latest','started group + DNF/DQ rollback','roster reconciliation','absence keeps audit+entry+duties','attendance lost-response retry + stale opposite/future refusal','absent duty + legacy refusal/removal','absent run refusal+explicit restore','confirmed addition rollback','anonymous authorization','staff-only/ordinary/system-only authorization','direct absent UPDATE denied','cancelled attempted competition blocks duties / empty cancellation allows']);

ROLLBACK;

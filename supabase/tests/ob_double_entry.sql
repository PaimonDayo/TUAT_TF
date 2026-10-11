-- Run after the migration inside an outer BEGIN ending ROLLBACK.
-- Generated fixtures only. Existing event rows/positions/results are retained.
DO $test$
DECLARE actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); staff_role uuid;
 e uuid; request uuid:=gen_random_uuid(); result jsonb; repeated jsonb; op public.ob_event_operations%ROWTYPE;
 saved jsonb; draft jsonb; before_person jsonb; before_count integer; rev integer; context jsonb; changes jsonb; before_hash text;
 event text:='男子1500m'; other text:='男子3000m'; name text:='__double_entry_'||gen_random_uuid()::text;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO auth.users(id,email) SELECT id,'double-'||id||'@example.invalid' FROM unnest(ARRAY[actor,outsider,member]) id;
 INSERT INTO public.profiles(id,email,display_name,blocks,grade,status,approved)
 SELECT id,'double-'||id||'@example.invalid','__double_person_'||id,'{}','1','active',true FROM unnest(ARRAY[actor,outsider,member]) id
 ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,blocks=excluded.blocks,grade=excluded.grade,status=excluded.status,approved=excluded.approved;
 DELETE FROM public.profile_roles WHERE profile_id=ANY(ARRAY[actor,outsider,member]);
 SELECT id INTO staff_role FROM public.roles r WHERE r.name='OB戦2026';
 IF staff_role IS NULL THEN RAISE EXCEPTION 'staff fixture missing'; END IF;
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(actor,staff_role);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 -- Rehearsal-only reopening retains all real placements/results.
 UPDATE public.ob_event_operations SET data=jsonb_set(data,'{confirmed}','false') WHERE meet_key='ob-2026' AND event_name IN (event,other);
 e:=public.create_ob_guest_registration(name,'B1',ARRAY[event],'{}','未回答',NULL,NULL);
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 saved:=public.save_ob_event_operation_checked(event,op.revision,jsonb_build_object('confirmed',false,'participants',coalesce(op.data->'participants','[]'::jsonb)||jsonb_build_array(jsonb_build_object('entryId',e,'group',97,'order',597,'status','entered','trials',jsonb_build_array(jsonb_build_object('mark','4:10.00','wind','','status','valid'))))),NULL);
 SELECT value INTO before_person FROM jsonb_array_elements(saved->'data'->'participants') p WHERE value->>'entryId'=e::text;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=e;
 -- This heat already has a real result. New second appearance gets an unused number.
 result:=public.add_ob_day_entry(request,event,e,rev,NULL,NULL,97);
 IF result->>'entryId'<>e::text||':2' THEN RAISE EXCEPTION 'second identity missing'; END IF;
 IF (SELECT value FROM jsonb_array_elements(result->'saved'->'data'->'participants') p WHERE value->>'entryId'=e::text) IS DISTINCT FROM before_person THEN RAISE EXCEPTION 'first result changed'; END IF;
 IF (SELECT count(*) FROM public.ob_meet_entries WHERE id=e AND events=ARRAY[event,event])<>1 THEN RAISE EXCEPTION 'registration not doubled'; END IF;
 repeated:=public.add_ob_day_entry(request,event,e,rev,NULL,NULL,97);
 IF repeated<>result OR (SELECT count(*) FROM public.ob_operation_changes WHERE request_id=request)<>1 THEN RAISE EXCEPTION 'retry duplicated registration'; END IF;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=e;
 BEGIN PERFORM public.add_ob_day_entry(gen_random_uuid(),event,e,rev,NULL,NULL,NULL); RAISE EXCEPTION 'third accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_limit' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_ob_entry(e,NULL,rev,ARRAY[event,event,event],'{}'); RAISE EXCEPTION 'three event edit accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_invalid' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_ob_entry(e,NULL,rev-1,ARRAY[event],'{}'); RAISE EXCEPTION 'stale accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_conflict' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 BEGIN PERFORM public.save_ob_entry(e,NULL,rev,ARRAY[event],'{}'); RAISE EXCEPTION 'other person accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 -- Independent result input uses the second identity; the original remains byte-for-byte equal.
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 SELECT jsonb_build_object('confirmed',false,'participants',jsonb_agg(CASE WHEN p->>'entryId'=e::text||':2' THEN jsonb_set(p,'{trials}',jsonb_build_array(jsonb_build_object('mark','4:20.00','wind','','status','valid'))) ELSE p END ORDER BY n)) INTO draft FROM jsonb_array_elements(op.data->'participants') WITH ORDINALITY rows(p,n);
 saved:=public.save_ob_event_operation_checked(event,op.revision,draft,op.data);
 IF (SELECT value FROM jsonb_array_elements(saved->'data'->'participants') p WHERE value->>'entryId'=e::text) IS DISTINCT FROM before_person THEN RAISE EXCEPTION 'first overwritten'; END IF;
 -- Cancellation preserves both historical performances and restores without duplication.
 PERFORM public.save_ob_entry(e,NULL,rev,ARRAY[event],'{}');
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 IF jsonb_array_length(op.data->'participants')<>jsonb_array_length(saved->'data'->'participants') THEN RAISE EXCEPTION 'cancel erased result'; END IF;
 BEGIN PERFORM public.delete_ob_registration(e,rev+1); RAISE EXCEPTION 'delete erased results'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_has_operations' THEN RAISE; END IF; END;
 PERFORM public.save_ob_entry(e,NULL,rev+1,ARRAY[event,event],'{}');
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 saved:=public.save_ob_event_operation_checked(event,op.revision,op.data,NULL);
 IF (SELECT count(*) FROM jsonb_array_elements(saved->'data'->'participants') p WHERE p->>'entryId' IN (e::text,e::text||':2'))<>2 THEN RAISE EXCEPTION 'restore duplicated'; END IF;
 -- General members can register/edit two own appearances; no role expansion.
 PERFORM set_config('request.jwt.claim.sub',member::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 PERFORM public.save_ob_entry(NULL,member,NULL,ARRAY[other,other],'{}');
 -- Private sheet edits address each appearance independently and retain results.
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=e;
 SELECT jsonb_build_object('entries',jsonb_agg(jsonb_build_object('id',id,'revision',revision)),'operations','[]'::jsonb) INTO context FROM public.ob_meet_entries WHERE meet_key='ob-2026';
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 changes:=jsonb_build_array(jsonb_build_object('entryId',e::text||':2','entryRevision',rev,'event',event,'operationRevision',op.revision,'status','DNS','position',false,'newKey',NULL,'name',NULL,'grade',NULL));
 PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,true);
 IF (SELECT data FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event) IS DISTINCT FROM op.data THEN RAISE EXCEPTION 'dryRun mutated'; END IF;
 PERFORM public.apply_ob_sheet_edits(gen_random_uuid(),context,changes,false);
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 IF (SELECT value FROM jsonb_array_elements(op.data->'participants') p WHERE value->>'entryId'=e::text) IS DISTINCT FROM before_person THEN RAISE EXCEPTION 'sheet first overwritten'; END IF;
 IF (SELECT value->>'status' FROM jsonb_array_elements(op.data->'participants') p WHERE value->>'entryId'=e::text||':2')<>'DNS' THEN RAISE EXCEPTION 'second DNS missing'; END IF;
 RAISE NOTICE 'two appearances, recorded heat addition, retry, independent results, cancellation, self/other permissions and private sheet dryRun passed';
END $test$;

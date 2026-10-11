-- Generated fixtures only. Run in an outer BEGIN ending ROLLBACK.
DO $test$
DECLARE actor uuid:=gen_random_uuid(); staff_role uuid; a uuid; b uuid; c uuid;
 orphan uuid:=gen_random_uuid(); event text:='男子100m'; other text:='男子300m'; field text:='男子砲丸投げ';
 name text:='__unified_dns_'||gen_random_uuid()::text; op public.ob_event_operations%ROWTYPE;
 saved jsonb; result jsonb; proposal jsonb; first jsonb; rev integer;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO auth.users(id,email) VALUES(actor,'unified-'||actor||'@example.invalid');
 INSERT INTO public.profiles(id,email,display_name,blocks,grade,status,approved)
 VALUES(actor,'unified-'||actor||'@example.invalid',name,'{}','1','active',true)
 ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,blocks='{}',grade='1',status='active',approved=true;
 DELETE FROM public.profile_roles WHERE profile_id=actor;
 SELECT id INTO staff_role FROM public.roles r WHERE r.name='OB戦2026';
 IF staff_role IS NULL THEN RAISE EXCEPTION 'staff fixture missing'; END IF;
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(actor,staff_role);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 UPDATE public.ob_event_operations SET data=jsonb_set(data,'{confirmed}','false') WHERE meet_key='ob-2026' AND event_name IN (event,other,field);
 a:=public.create_ob_guest_registration(name,'B1',ARRAY[event,event,other],'{}','未回答',NULL,NULL);
 b:=public.create_ob_guest_registration(name||'_next','B1',ARRAY[other],'{}','未回答',NULL,NULL);
 c:=public.create_ob_guest_registration(name||'_field','B1',ARRAY[field],'{}','未回答',NULL,NULL);
 FOR op IN SELECT * FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name IN (event,other,field) LOOP
  proposal:=jsonb_build_object('confirmed',false,'participants',op.data->'participants');
  IF op.event_name=event THEN
   proposal:=jsonb_set(proposal,'{participants}',(proposal->'participants')||jsonb_build_array(
    jsonb_build_object('entryId',a,'group',96,'order',1,'heatScope','混合','status','entered','trials',jsonb_build_array(jsonb_build_object('mark','12.34','status','valid','wind','0'))),
    jsonb_build_object('entryId',a::text||':2','group',96,'order',2,'heatScope','混合','status','entered','trials','[]'::jsonb)));
  ELSIF op.event_name=other THEN
   proposal:=jsonb_set(proposal,'{participants}',(proposal->'participants')||jsonb_build_array(
    jsonb_build_object('entryId',a,'group',96,'order',1,'status','entered','trials','[]'::jsonb),
    jsonb_build_object('entryId',b,'group',96,'order',2,'status','entered','trials','[]'::jsonb)));
  ELSE
   proposal:=jsonb_set(proposal,'{participants}',(proposal->'participants')||jsonb_build_array(jsonb_build_object('entryId',c,'group',96,'order',1,'status','entered','trials',jsonb_build_array(jsonb_build_object('mark','8.50','status','valid','wind','')))));
  END IF;
  PERFORM public.save_ob_event_operation_checked(op.event_name,op.revision,proposal,NULL);
 END LOOP;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=a;
 PERFORM public.set_ob_attendance(a,rev,true);
 IF EXISTS(SELECT 1 FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p WHERE p->>'entryId' IN (a::text,a::text||':2') AND (p->>'status'<>'DNS' OR p->'group'<>'null'::jsonb OR p->'order'<>'null'::jsonb OR p ? 'heatScope')) THEN RAISE EXCEPTION 'attendance retained a frame'; END IF;
 IF (SELECT p->'trials' FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p WHERE o.event_name=event AND p->>'entryId'=a::text)<>jsonb_build_array(jsonb_build_object('mark','12.34','status','valid','wind','0')) THEN RAISE EXCEPTION 'attendance lost trials'; END IF;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=a;
 PERFORM public.set_ob_attendance(a,rev,false);
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(op.data->'participants') p WHERE p->>'entryId'=a::text AND p->>'status'<>'DNS') THEN RAISE EXCEPTION 'attendance restored a lane'; END IF;
 -- Explicitly resume and place, then cancel the whole event.
 SELECT jsonb_build_object('confirmed',false,'participants',jsonb_agg(CASE WHEN p->>'entryId'=a::text THEN p||jsonb_build_object('status','entered','group',96,'order',1) ELSE p END ORDER BY n)) INTO proposal FROM jsonb_array_elements(op.data->'participants') WITH ORDINALITY rows(p,n);
 PERFORM public.save_ob_event_operation_checked(event,op.revision,proposal,NULL);
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=a;
 PERFORM public.save_ob_entry(a,NULL,rev,ARRAY[other],'{}');
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=b;
 result:=public.add_ob_day_entry(gen_random_uuid(),event,b,rev,NULL,NULL,96);
 IF (SELECT p->'order' FROM jsonb_array_elements(result->'saved'->'data'->'participants') p WHERE p->>'entryId'=b::text)<>'1'::jsonb THEN RAISE EXCEPTION 'cancelled lane not reusable'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'saved'->'data'->'participants') p WHERE p->>'entryId' IN (a::text,a::text||':2') AND (p->>'status'<>'DNS' OR p->'group'<>'null'::jsonb OR p->'order'<>'null'::jsonb)) THEN RAISE EXCEPTION 'cancellation retained lane'; END IF;
 -- Cancel only the second appearance, preserving the first appearance and its placement.
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=a;
 PERFORM public.save_ob_entry(a,NULL,rev,ARRAY[event,event,other],'{}');
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 SELECT jsonb_build_object('confirmed',false,'participants',jsonb_agg(CASE WHEN p->>'entryId' IN (a::text,a::text||':2') THEN p||jsonb_build_object('status','entered','group',96,'order',CASE WHEN p->>'entryId'=a::text THEN 2 ELSE 3 END) ELSE p END ORDER BY n)) INTO proposal FROM jsonb_array_elements(op.data->'participants') WITH ORDINALITY rows(p,n);
 saved:=public.save_ob_event_operation_checked(event,op.revision,proposal,NULL);
 SELECT p INTO first FROM jsonb_array_elements(saved->'data'->'participants') p WHERE p->>'entryId'=a::text;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=a;
 PERFORM public.save_ob_entry(a,NULL,rev,ARRAY[event,other],'{}');
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 IF (SELECT p FROM jsonb_array_elements(op.data->'participants') p WHERE p->>'entryId'=a::text) IS DISTINCT FROM first THEN RAISE EXCEPTION 'second cancellation changed first'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(op.data->'participants') p WHERE p->>'entryId'=a::text||':2' AND (p->>'status'<>'DNS' OR p->'order'<>'null'::jsonb)) THEN RAISE EXCEPTION 'second cancellation retained slot'; END IF;
 -- Field cancellation releases the same placement while keeping every trial.
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=c;
 PERFORM public.save_ob_entry(c,NULL,rev,'{}','{}');
 IF NOT EXISTS(SELECT 1 FROM public.ob_event_operations o CROSS JOIN LATERAL jsonb_array_elements(o.data->'participants') p WHERE o.event_name=field AND p->>'entryId'=c::text AND p->>'status'='DNS' AND p->'group'='null'::jsonb AND p->'order'='null'::jsonb AND p->'trials'=jsonb_build_array(jsonb_build_object('mark','8.50','status','valid','wind',''))) THEN RAISE EXCEPTION 'field cancellation lost trial or retained slot'; END IF;
 -- Orphaned saved rows release their placement and remain immutable during other edits.
 UPDATE public.ob_event_operations SET data=jsonb_set(data,'{participants}',(data->'participants')||jsonb_build_array(jsonb_build_object('entryId',orphan,'group',96,'order',4,'status','entered','trials','[]'::jsonb))),revision=revision+1 WHERE meet_key='ob-2026' AND event_name=event;
 SELECT * INTO op FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name=event;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(op.data->'participants') p WHERE p->>'entryId'=orphan::text AND (p->>'status'<>'DNS' OR p->'order'<>'null'::jsonb)) THEN RAISE EXCEPTION 'orphan retained lane'; END IF;
 PERFORM public.save_ob_event_operation_checked(event,op.revision,op.data,NULL);
 BEGIN
  PERFORM public.save_ob_event_operation_checked(event,op.revision,jsonb_set(op.data,'{participants}',(op.data->'participants')||jsonb_build_array(jsonb_build_object('entryId',gen_random_uuid(),'group',NULL,'order',NULL,'status','DNS','trials','[]'::jsonb))),NULL);
  RAISE EXCEPTION 'invented orphan accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN ('operation_roster','operation_conflict') THEN RAISE; END IF; END;
 RAISE NOTICE 'attendance, all/second cancellation, recorded track/field history, day addition and orphan preservation passed';
END $test$;

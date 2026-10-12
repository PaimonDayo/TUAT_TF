-- Transaction rollback only. The temporary competitions and role never persist.
DO $$
DECLARE actor uuid; system_actor uuid; staff_role uuid:=gen_random_uuid(); person uuid:=gen_random_uuid(); helper uuid:=gen_random_uuid(); appearance uuid:=gen_random_uuid(); duty uuid; request uuid; command jsonb; rights jsonb; response jsonb;
 comp text:='codex-ob-access-20261013'; generic text:='codex-generic-access-20261013'; kept jsonb:='{"entryId":"","group":1,"order":1,"status":"entered","trials":[{"mark":"12.34","status":"valid","wind":"0"}]}';
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 FOR system_actor IN SELECT id FROM public.profiles WHERE approved LOOP
  PERFORM set_config('request.jwt.claim.sub',system_actor::text,true);
  IF public.can_manage_system() THEN EXIT; END IF;
 END LOOP;
 IF NOT public.can_manage_system() THEN RAISE EXCEPTION 'System fixture actor unavailable'; END IF;
 FOR actor IN SELECT id FROM public.profiles WHERE approved AND status='active' AND id<>system_actor LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  IF NOT public.can_manage_system() THEN EXIT; END IF;
 END LOOP;
 IF actor IS NULL OR public.can_manage_system() THEN RAISE EXCEPTION 'Member fixture actor unavailable'; END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.roles(id,name) VALUES(staff_role,'合成大会担当・一時検証');
 INSERT INTO public.competitions(id,name,starts_on) VALUES(comp,'合成OB権限検証','2026-10-13'),(generic,'合成他大会権限検証','2026-10-13');
 INSERT INTO public.competition_meets(competition_id,meet_key,staff_role_id,legacy_source,ready) VALUES(comp,comp,staff_role,'ob-2026',true),(generic,generic,staff_role,NULL,true);
 INSERT INTO public.competition_meet_events(competition_id,name,family,division,starts_at,discipline,wind,capacity) VALUES(comp,'男子100m','100m','男子','10:00','track',true,8);
 INSERT INTO public.competition_participants(id,competition_id,profile_id,name,grade) VALUES(person,comp,actor,'合成本人','B1'),(helper,comp,NULL,'合成補助担当','B2');
 kept:=jsonb_set(kept,'{entryId}',to_jsonb(appearance::text));
 INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,qualification_mark,performance) VALUES(appearance,comp,person,'男子100m',1,appearance::text,'13.00',kept);
 INSERT INTO public.competition_meet_party(competition_id,participant_id,name,group_label,status) VALUES(comp,person,'合成本人','B1','未回答');
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 rights:=public.competition_meet_permissions(comp);
 IF rights->>'manage'<>'false' OR rights->>'record'<>'false' OR rights->>'register'<>'false' OR rights->>'groups'<>'false' OR rights->>'history'<>'false' THEN RAISE EXCEPTION 'Nonstaff operational permission'; END IF;
 IF public.get_competition_meet(comp)->'appearances'->0->>'id' IS DISTINCT FROM appearance::text THEN RAISE EXCEPTION 'Results unreadable'; END IF;
 FOR command IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('action','participant.save','id',person,'revision',0,'name','合成本人','grade','B1','profileId',actor),
  jsonb_build_object('action','appearance.add','participantId',person,'event','男子100m'),
  jsonb_build_object('action','appearance.edit','id',appearance,'revision',0,'mark','99.00'),
  jsonb_build_object('action','appearance.cancel','id',appearance,'revision',0),
  jsonb_build_object('action','appearance.delete','id',appearance,'revision',0),
  jsonb_build_object('action','appearance.restore','id',appearance,'revision',0),
  jsonb_build_object('action','party.save','id',(SELECT id FROM public.competition_meet_party WHERE competition_id=comp),'revision',0,'status','参加'),
  jsonb_build_object('action','event.save','event','男子100m','revision',0,'confirmed',false,'changes','[]'::jsonb))) LOOP
  request:=gen_random_uuid();
  BEGIN PERFORM public.mutate_competition_meet(comp,request,command); RAISE EXCEPTION 'Nonstaff mutation accepted: %',command->>'action'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.competition_meet_requests WHERE id=request) OR (SELECT revision FROM public.competition_participants WHERE id=person)<>0 OR (SELECT performance FROM public.competition_appearances WHERE id=appearance) IS DISTINCT FROM kept OR (SELECT revision FROM public.competition_appearances WHERE id=appearance)<>0 THEN RAISE EXCEPTION 'Rejected mutation partially committed'; END IF;
 END LOOP;
 BEGIN PERFORM public.get_competition_meet_history(comp,NULL); RAISE EXCEPTION 'Nonstaff history accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',system_actor::text,true);
 rights:=public.competition_meet_permissions(comp);
 IF rights->>'configure'<>'true' OR rights->>'record'<>'false' OR rights->>'groups'<>'false' OR rights->>'manage'<>'false' THEN RAISE EXCEPTION 'System scope changed'; END IF;
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),'{"action":"event.configure","config":{"name":"女子100m","family":"100m","division":"女子","starts_at":"10:00","sort_order":1,"discipline":"track","wind":true,"capacity":8}}');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.profile_roles(profile_id,role_id) VALUES(actor,staff_role);
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 IF public.competition_meet_permissions(comp)->>'manage'<>'true' THEN RAISE EXCEPTION 'Assigned staff unavailable'; END IF;
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','appearance.cancel','id',appearance,'revision',0));
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','appearance.restore','id',appearance,'revision',1));
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','appearance.delete','id',appearance,'revision',2));
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','appearance.restore','id',appearance,'revision',3));
 IF (SELECT performance->'trials' FROM public.competition_appearances WHERE id=appearance) IS DISTINCT FROM kept->'trials' OR (SELECT qualification_mark FROM public.competition_appearances WHERE id=appearance)<>'13.00' THEN RAISE EXCEPTION 'Staff lifecycle lost data'; END IF;
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','appearance.add','participantId',person,'event','男子100m'));
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','appearance.add','participantId',person,'event','男子100m'));
 IF (SELECT count(*) FROM public.competition_appearances WHERE participant_id=person)<>3 THEN RAISE EXCEPTION 'Repeated appearance unavailable'; END IF;
 response:=public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','duty.save','participantId',helper,'time','10:00','event','100m','assignment','計時','roleIds','[]'::jsonb)); duty:=(response->>'id')::uuid;
 PERFORM public.mutate_competition_meet(comp,gen_random_uuid(),jsonb_build_object('action','duty.save','id',duty,'revision',0,'participantId',helper,'assignment','','roleIds','[]'::jsonb));
 IF (SELECT assignment FROM public.competition_meet_duties WHERE id=duty)<>'' THEN RAISE EXCEPTION 'Duty clear unavailable'; END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 DELETE FROM public.profile_roles WHERE profile_id=actor AND role_id=staff_role;
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 rights:=public.competition_meet_permissions(generic);
 IF rights->>'register'<>'true' OR rights->>'record'<>'true' THEN RAISE EXCEPTION 'Other meet permission changed'; END IF;
 PERFORM public.mutate_competition_meet(generic,gen_random_uuid(),jsonb_build_object('action','participant.save','name','合成本人','grade','B1','profileId',actor));
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.competition_meet_requests(id,competition_id,command,result) VALUES(gen_random_uuid(),comp,'{"action":"sheet.edits"}','{}');
END $$;
SELECT jsonb_build_object('nonstaffDenied',8,'rejectedWritesRolledBack',true,'systemConfiguration',true,'staffLifecycle',true,'genericPolicyPreserved',true,'serviceAllowed',true);

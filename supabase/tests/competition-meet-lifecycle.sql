-- Run inside a rollback transaction, after the new migration; no fixture persists.
DO $$
DECLARE actor uuid; competitor uuid; participant uuid; other uuid; appearance uuid; second uuid; third uuid; response jsonb; request uuid; command jsonb; revision integer; kept jsonb; helper uuid; helper_appearance uuid; duty uuid; role_id uuid; digest text; original jsonb; legacy_competition text:='3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5';
BEGIN
 IF has_column_privilege('authenticated','public.competition_participants','legacy_data','SELECT') OR has_table_privilege('authenticated','public.competition_meet_requests','SELECT') THEN RAISE EXCEPTION 'Private migration data exposed'; END IF;
 IF EXISTS(SELECT 1 FROM public.ob_meet_entries source LEFT JOIN public.competition_participants target ON target.id=source.id WHERE source.meet_key='ob-2026' AND (target.id IS NULL OR target.legacy_data IS DISTINCT FROM to_jsonb(source))) THEN RAISE EXCEPTION 'Participant source changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.ob_event_operations source CROSS JOIN LATERAL jsonb_array_elements(source.data->'participants') person LEFT JOIN public.competition_appearances target ON target.competition_id=legacy_competition AND target.event_name=source.event_name AND target.operation_key=person->>'entryId' WHERE source.meet_key='ob-2026' AND (target.id IS NULL OR target.performance-'entryId' IS DISTINCT FROM person-'entryId')) THEN RAISE EXCEPTION 'Saved appearance changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.ob_duty_roles source LEFT JOIN public.competition_meet_duty_roles target ON target.id=source.id WHERE source.meet_key='ob-2026' AND (target.id IS NULL OR target.abbreviation IS DISTINCT FROM source.abbreviation OR target.required_count IS DISTINCT FROM source.required_count)) THEN RAISE EXCEPTION 'Helper role changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.ob_party_responses source LEFT JOIN public.competition_meet_party target ON target.id=source.id WHERE source.meet_key='ob-2026' AND (target.id IS NULL OR target.participant_id IS DISTINCT FROM source.entry_id OR target.status IS DISTINCT FROM source.status OR target.needs_review IS DISTINCT FROM source.needs_review)) THEN RAISE EXCEPTION 'Party answer changed'; END IF;
 FOR actor IN SELECT id FROM public.profiles WHERE approved LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  IF public.can_manage_system() THEN EXIT; END IF;
 END LOOP;
 IF NOT public.can_manage_system() THEN RAISE EXCEPTION 'Test operator is unavailable'; END IF;
 IF public.competition_meet_trial_valid('{"mark":"12.60","status":"valid","wind":"0"}','track',true) IS DISTINCT FROM true OR public.competition_meet_trial_valid('{"mark":"1:60","status":"valid","wind":"0"}','track',true) OR public.competition_meet_trial_valid('{"mark":"-2","status":"valid","wind":"0"}','distance',true) OR public.competition_meet_trial_valid('{"mark":"1.20","status":"foul","wind":""}','height',false) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Trial validation failed'; END IF;
 INSERT INTO public.competitions(id,name,starts_on) VALUES('codex-meet-rehearsal-20261012','合成大会・移行試験','2026-10-12');
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),'{"action":"event.configure","config":{"name":"男子100m","family":"100m","division":"男子","starts_at":"10:00","sort_order":0,"discipline":"track","wind":true,"capacity":8}}');
 command:='{"action":"participant.save","name":"合成同姓同名","grade":"B1","profileId":null}';request:=gen_random_uuid();
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',request,command);participant:=(response->>'id')::uuid;
 IF public.mutate_competition_meet('codex-meet-rehearsal-20261012',request,command) IS DISTINCT FROM response OR public.check_competition_meet_mutation('codex-meet-rehearsal-20261012',request,command) IS DISTINCT FROM response THEN RAISE EXCEPTION 'Replay/check failed'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),'{"action":"participant.save","name":"合成同姓同名","grade":"M1","profileId":null}');other:=(response->>'id')::uuid;
 IF participant=other THEN RAISE EXCEPTION 'Distinct people merged'; END IF;
 command:=jsonb_build_object('action','appearance.add','participantId',participant,'event','男子100m','mark','12.00');
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),command);appearance:=(response->>'id')::uuid;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),command);second:=(response->>'id')::uuid;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),command);third:=(response->>'id')::uuid;
 IF (SELECT count(*) FROM public.competition_appearances WHERE participant_id=participant)<>3 THEN RAISE EXCEPTION 'Three appearances failed'; END IF;
 UPDATE public.competition_appearances SET performance=performance||'{"status":"DQ"}'::jsonb WHERE id=third;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.cancel','id',third,'revision',0));
 IF (SELECT performance->>'status' FROM public.competition_appearances WHERE id=third)<>'DQ' OR NOT public.competition_meet_participant_busy('codex-meet-rehearsal-20261012',participant,'10:00') THEN RAISE EXCEPTION 'Cancellation erased disqualification'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.restore','id',third,'revision',1));
 IF (SELECT performance->>'status' FROM public.competition_appearances WHERE id=third)<>'DQ' THEN RAISE EXCEPTION 'Restore erased disqualification'; END IF;
 kept:=jsonb_build_object('entryId',appearance,'group',1,'order',1,'status','entered','trials',jsonb_build_array(jsonb_build_object('mark','12.34','wind','0','status','valid')));
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','event.save','event','男子100m','revision',0,'confirmed',false,'changes',jsonb_build_array(jsonb_build_object('id',appearance,'revision',0,'performance',kept))));
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.cancel','id',appearance,'revision',1));
 IF (SELECT performance->'trials' FROM public.competition_appearances WHERE id=appearance) IS DISTINCT FROM kept->'trials' OR (SELECT state FROM public.competition_appearances WHERE id=second)<>'registered' THEN RAISE EXCEPTION 'Individual cancellation erased data'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.restore','id',appearance,'revision',2));
 IF (SELECT performance->>'group' FROM public.competition_appearances WHERE id=appearance) IS NOT NULL THEN RAISE EXCEPTION 'Restore reoccupied slot'; END IF;
 BEGIN
  PERFORM public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.cancel','id',appearance,'revision',1));
  RAISE EXCEPTION 'Stale revision accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'meet_conflict' THEN RAISE; END IF; END;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','participant.delete','id',participant,'revision',0));
 IF (SELECT performance->'trials' FROM public.competition_appearances WHERE id=appearance) IS DISTINCT FROM kept->'trials' THEN RAISE EXCEPTION 'Delete erased trials'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','participant.restore','id',participant,'revision',1));
 IF (SELECT count(*) FROM public.competition_appearances WHERE participant_id=participant)<>3 THEN RAISE EXCEPTION 'Restore lost appearances'; END IF;
 IF public.check_competition_meet_mutation('codex-meet-rehearsal-20261012',gen_random_uuid(),command)->>'notSaved' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Missing save not recognized'; END IF;
 IF public.check_competition_meet_mutation('codex-meet-rehearsal-20261012',request,command||jsonb_build_object('backend',CASE public.get_competition_meet_backend() WHEN 'pc' THEN 'cloud' ELSE 'pc' END)) IS NOT NULL THEN RAISE EXCEPTION 'Switched backend approved retry'; END IF;
 -- Two writers can save different appearances without overwriting one another.
 SELECT event.revision INTO revision FROM public.competition_meet_events event WHERE competition_id='codex-meet-rehearsal-20261012' AND name='男子100m';
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.restore','id',second,'revision',(SELECT x.revision FROM public.competition_appearances x WHERE id=second)));
 kept:=jsonb_build_object('entryId',second,'group',NULL,'order',NULL,'status','entered','trials',jsonb_build_array(jsonb_build_object('mark','13.34','wind','0','status','valid')));
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','event.save','event','男子100m','revision',revision,'expectedConfirmed',false,'confirmed',false,'changes',jsonb_build_array(jsonb_build_object('id',second,'revision',(SELECT x.revision FROM public.competition_appearances x WHERE id=second),'performance',kept))));
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.restore','id',third,'revision',(SELECT x.revision FROM public.competition_appearances x WHERE id=third)));
 kept:=kept||jsonb_build_object('entryId',third,'trials',jsonb_build_array(jsonb_build_object('mark','14.34','wind','0','status','valid')));
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','event.save','event','男子100m','revision',revision,'expectedConfirmed',false,'confirmed',false,'changes',jsonb_build_array(jsonb_build_object('id',third,'revision',(SELECT x.revision FROM public.competition_appearances x WHERE id=third),'performance',kept))));
 IF (SELECT performance->'trials'->0->>'mark' FROM public.competition_appearances WHERE id=second)<>'13.34' THEN RAISE EXCEPTION 'Independent result overwritten'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),'{"action":"participant.save","name":"合成補助担当","grade":"B2","profileId":null}');helper:=(response->>'id')::uuid;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),'{"action":"role.save","event":"100m","time":"10:00","name":"合成計時","requiredCount":1}');role_id:=(response->>'id')::uuid;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','duty.save','participantId',helper,'event','100m','time','10:00','assignment','','roleIds',jsonb_build_array(role_id)));duty:=(response->>'id')::uuid;
 BEGIN
  PERFORM public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.add','participantId',helper,'event','男子100m'));
  RAISE EXCEPTION 'Duty overlap not confirmed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'meet_duty_confirmation' THEN RAISE; END IF; END;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','appearance.add','participantId',helper,'event','男子100m','confirmDuties',true));helper_appearance:=(response->>'id')::uuid;
 IF NOT public.competition_meet_participant_busy('codex-meet-rehearsal-20261012',helper,'10:00') THEN RAISE EXCEPTION 'Helper conflict lost'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','participant.delete','id',helper,'revision',0));
 IF NOT EXISTS(SELECT 1 FROM public.competition_meet_duties WHERE id=duty AND participant_id=helper AND role_ids=ARRAY[role_id]) THEN RAISE EXCEPTION 'Deleted participant lost duty'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','duty.save','id',duty,'revision',0,'participantId',other,'assignment','','roleIds',jsonb_build_array(role_id)));
 IF NOT EXISTS(SELECT 1 FROM public.competition_meet_duties WHERE id=duty AND participant_id=other) THEN RAISE EXCEPTION 'Duty replacement failed'; END IF;
 IF jsonb_array_length(public.get_competition_meet_history('codex-meet-rehearsal-20261012',NULL))=0 THEN RAISE EXCEPTION 'History unavailable'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','party.save','participantId',other,'status','参加'));
 IF NOT EXISTS(SELECT 1 FROM public.competition_meet_party WHERE id=(response->>'id')::uuid AND participant_id=other AND status='参加') THEN RAISE EXCEPTION 'Party reply creation failed'; END IF;
 response:=public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','event.save','event','男子100m','revision',(SELECT event.revision FROM public.competition_meet_events event WHERE competition_id='codex-meet-rehearsal-20261012' AND name='男子100m'),'changes','[]'::jsonb,'confirmed',true));
 BEGIN
  PERFORM public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','participant.delete','id',participant,'revision',2));
  RAISE EXCEPTION 'Confirmed meet was modified through participant deletion';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'meet_confirmed' THEN RAISE; END IF; END;
 -- An invalid row aborts the entire mirror unit, including earlier valid rows.
 original:=(SELECT to_jsonb(x) FROM public.competition_participants x WHERE id=other);
 BEGIN
  PERFORM public.replay_competition_meet_changes(jsonb_build_array(jsonb_build_object('id',1,'table_name','competition_participants','op','UPDATE','pk',jsonb_build_object('id',other),'row_data',original||jsonb_build_object('name','wrong'),'changed',jsonb_build_array('name')),jsonb_build_object('id',2,'table_name','competition_participants','op','DELETE','pk','{}'::jsonb)));
  RAISE EXCEPTION 'Invalid mirror batch accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'meet_invalid' THEN RAISE; END IF; END;
 IF (SELECT to_jsonb(x) FROM public.competition_participants x WHERE id=other) IS DISTINCT FROM original THEN RAISE EXCEPTION 'Partial mirror batch persisted'; END IF;
 -- Activation refreshes the latest source and then makes legacy writes fail explicitly.
 IF EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=legacy_competition) THEN
  response:=public.set_competition_meet_source_frozen(true);
  DELETE FROM public.failover_changes WHERE table_name LIKE 'ob_%'; -- rollback-only fixture, never the live activation procedure
  digest:=public.competition_meet_source_digest();
  response:=public.refresh_competition_meet_import(true,digest);
  IF response->>'ready' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Activation failed'; END IF;
  BEGIN
   UPDATE public.ob_meet_entries SET grade=grade WHERE meet_key='ob-2026';
   IF EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE meet_key='ob-2026') THEN RAISE EXCEPTION 'Legacy source remains writable'; END IF;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'meet_migrated_reload' THEN RAISE; END IF; END;
  IF public.refresh_competition_meet_import(false,NULL)->>'alreadyReady' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Import resurrected canonical source'; END IF;
  -- The existing signed sheet protocol retains saved trials, supports added events,
  -- and rolls dry-run changes and their request ledger back together.
  participant:=gen_random_uuid();appearance:=gen_random_uuid();
  INSERT INTO public.competition_participants(id,competition_id,name,grade) VALUES(participant,legacy_competition,'合成シート参加者','B1');
  kept:=jsonb_build_object('entryId',appearance,'group',NULL,'order',NULL,'status','entered','trials',jsonb_build_array(jsonb_build_object('mark','12.34','wind','0','status','valid')));
  INSERT INTO public.competition_appearances(id,competition_id,participant_id,event_name,ordinal,operation_key,performance) VALUES(appearance,legacy_competition,participant,'男子100m',1,appearance::text,kept);
  UPDATE public.competition_meet_events SET confirmed=false WHERE competition_id=legacy_competition AND name IN ('男子100m','女子100m');
  request:=gen_random_uuid();command:=jsonb_build_array(jsonb_build_object('event','男子100m','operationRevision',(SELECT event.revision FROM public.competition_meet_events event WHERE competition_id=legacy_competition AND name='男子100m'),'entryId',appearance,'entryRevision',0,'status','DNS'));
  response:=public.apply_competition_sheet_edits(request,NULL,command,true);
  IF (SELECT performance FROM public.competition_appearances WHERE id=appearance) IS DISTINCT FROM kept OR EXISTS(SELECT 1 FROM public.competition_meet_requests WHERE id=request) THEN RAISE EXCEPTION 'Sheet dry-run persisted'; END IF;
  response:=public.apply_competition_sheet_edits(request,NULL,command,false);
  IF public.apply_competition_sheet_edits(request,NULL,command,false) IS DISTINCT FROM response OR (SELECT performance->'trials' FROM public.competition_appearances WHERE id=appearance) IS DISTINCT FROM kept->'trials' THEN RAISE EXCEPTION 'Sheet replay or trial retention failed'; END IF;
  command:=jsonb_build_array(jsonb_build_object('event','女子100m','operationRevision',(SELECT event.revision FROM public.competition_meet_events event WHERE competition_id=legacy_competition AND name='女子100m'),'entryId',appearance,'entryRevision',1,'status','entered','position',false));
  response:=public.apply_competition_sheet_edits(gen_random_uuid(),'{}'::jsonb,command,false);
  IF NOT EXISTS(SELECT 1 FROM public.competition_appearances WHERE participant_id=participant AND event_name='女子100m' AND state='registered') THEN RAISE EXCEPTION 'Sheet added event lost participant'; END IF;
 END IF;
 FOR competitor IN SELECT id FROM public.profiles WHERE approved AND status='active' LOOP
  PERFORM set_config('request.jwt.claim.sub',competitor::text,true); IF NOT public.can_manage_system() THEN EXIT; END IF;
 END LOOP;
 IF NOT public.can_manage_system() THEN
  BEGIN
   PERFORM public.mutate_competition_meet('codex-meet-rehearsal-20261012',gen_random_uuid(),jsonb_build_object('action','participant.delete','id',other,'revision',0));
   RAISE EXCEPTION 'Unauthorized delete accepted';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN IF SQLERRM<>'meet_forbidden' THEN RAISE; END IF; END;
 END IF;
END $$;

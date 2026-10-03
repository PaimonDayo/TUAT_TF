-- Execute after the migration inside BEGIN ... ROLLBACK only.
DO $$ DECLARE staff uuid; member uuid; system_profile uuid; e uuid; rev integer; party_id uuid; party_revision integer; r uuid:=gen_random_uuid(); n text:='合成OB検証'||gen_random_uuid()::text;
BEGIN
 SELECT pr.profile_id INTO staff FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id WHERE r.name='OB戦2026' LIMIT 1;
 SELECT p.id INTO member FROM public.profiles p WHERE approved AND status='active' AND NOT EXISTS(SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id WHERE pr.profile_id=p.id AND (r.name='OB戦2026' OR r.can_manage_system OR r.can_manage_members)) LIMIT 1;
 SELECT pr.profile_id INTO system_profile FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id WHERE r.can_manage_system AND NOT EXISTS(SELECT 1 FROM public.profile_roles p2 JOIN public.roles r2 ON r2.id=p2.role_id WHERE p2.profile_id=pr.profile_id AND r2.name='OB戦2026') LIMIT 1;
 IF staff IS NULL OR member IS NULL THEN RAISE EXCEPTION 'fixture_missing'; END IF;
 PERFORM set_config('test.member',member::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',staff,'role','authenticated')::text,true);
 UPDATE public.failover_config SET log_changes=true WHERE id;
 e:=public.create_ob_guest_registration(n,'B1',ARRAY['男子1500m'],'{"男子1500m":"4:30"}','参加');
 IF NOT EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE id=e AND profile_id IS NULL AND grade='B1' AND events=ARRAY['男子1500m'] AND competition_division='男子') THEN RAISE EXCEPTION 'guest_not_saved'; END IF;
 BEGIN PERFORM public.create_ob_guest_registration(n||'　','B1',ARRAY['男子100m'],'{}','参加');RAISE EXCEPTION 'duplicate_allowed';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN PERFORM public.create_ob_guest_registration('無効'||n,'B1',ARRAY['男子100m','女子100m'],'{}','参加');RAISE EXCEPTION 'division_allowed';EXCEPTION WHEN raise_exception THEN IF SQLERRM='division_allowed' THEN RAISE;END IF;END;
 SELECT revision INTO rev FROM public.ob_meet_entries WHERE id=e;
 BEGIN PERFORM public.delete_ob_registration(e,rev+1);RAISE EXCEPTION 'stale_allowed';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_conflict' THEN RAISE;END IF;END;
 INSERT INTO public.ob_duty_roles(id,slot_time,event_name,name,abbreviation,required_count) VALUES(r,'11:00','100m',n,'検',1);
 PERFORM public.save_ob_entry_duty_roles(e,'11:00','100m',ARRAY[r],NULL);
 BEGIN PERFORM public.delete_ob_registration(e,rev);RAISE EXCEPTION 'duties_deleted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_has_duties' THEN RAISE;END IF;END;
 PERFORM public.save_ob_entry_duty_roles(e,'11:00','100m','{}',0);
 -- Synthetic operation row: deletion must preserve even provisional placements.
 INSERT INTO public.ob_event_operations(meet_key,event_name,data,revision) VALUES('ob-2026','男子1500m',jsonb_build_object('participants',jsonb_build_array(jsonb_build_object('entryId',e)),'confirmed',false),0)
 ON CONFLICT(meet_key,event_name) DO UPDATE SET data=excluded.data;
 BEGIN PERFORM public.delete_ob_registration(e,rev);RAISE EXCEPTION 'operations_deleted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_has_operations' THEN RAISE;END IF;END;
 DELETE FROM public.ob_event_operations WHERE meet_key='ob-2026' AND event_name='男子1500m';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',member,'role','authenticated')::text,true);
 BEGIN PERFORM public.create_ob_guest_registration('拒否'||n,'B1',ARRAY['男子100m'],'{}','未回答');RAISE EXCEPTION 'member_created';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.delete_ob_registration(e,rev);RAISE EXCEPTION 'member_deleted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF system_profile IS NOT NULL THEN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',system_profile,'role','authenticated')::text,true);
  BEGIN PERFORM public.delete_ob_registration(e,rev);RAISE EXCEPTION 'system_deleted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',staff,'role','authenticated')::text,true);
 IF public.delete_ob_registration(e,rev)<>e THEN RAISE EXCEPTION 'delete_return';END IF;
 IF EXISTS(SELECT 1 FROM public.ob_meet_entries WHERE id=e) OR EXISTS(SELECT 1 FROM public.ob_entry_duties WHERE entry_id=e) THEN RAISE EXCEPTION 'delete_incomplete';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ob_entry_changes WHERE entry_id IS NULL AND after_data->>'id'=e::text AND after_data->>'change_type'='entry_deleted') THEN RAISE EXCEPTION 'audit_missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ob_party_responses WHERE submitted_name=n AND entry_id IS NULL AND status='参加') THEN RAISE EXCEPTION 'party_lost';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.failover_changes WHERE table_name='ob_meet_entries' AND op='DELETE' AND pk->>'id'=e::text) THEN RAISE EXCEPTION 'delete_queue_missing';END IF;
 SELECT id,revision INTO party_id,party_revision FROM public.ob_party_responses WHERE submitted_name=n;
 e:=public.create_ob_guest_registration(n,'B1',ARRAY['男子100m'],'{}','参加',party_id,party_revision);
 IF NOT EXISTS(SELECT 1 FROM public.ob_party_responses WHERE id=party_id AND entry_id=e) THEN RAISE EXCEPTION 'party_relink_failed';END IF;
 PERFORM set_config('test.entries',(SELECT count(*)::text FROM public.ob_meet_entries WHERE meet_key='ob-2026'),true);
 PERFORM set_config('test.duties',(SELECT count(*)::text FROM public.ob_entry_duties WHERE meet_key='ob-2026'),true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',member,'role','authenticated')::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.can_view_ob_program() THEN RAISE EXCEPTION 'member_cannot_read';END IF;
 IF (SELECT count(*) FROM public.ob_meet_entries WHERE meet_key='ob-2026')<>current_setting('test.entries')::integer THEN RAISE EXCEPTION 'roster_incomplete';END IF;
 IF (SELECT count(*) FROM public.ob_entry_duties WHERE meet_key='ob-2026')<>current_setting('test.duties')::integer THEN RAISE EXCEPTION 'duties_incomplete';END IF;
 IF EXISTS(SELECT 1 FROM public.ob_entry_changes) THEN RAISE EXCEPTION 'audit_exposed';END IF;
 BEGIN DELETE FROM public.ob_meet_entries;RAISE EXCEPTION 'direct_delete_allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM 1 FROM public.ob_meet_entries;RAISE EXCEPTION 'anon_read';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.create_ob_guest_registration('匿名','B1',ARRAY['男子100m'],'{}','参加');RAISE EXCEPTION 'anon_write';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT 'OB access, guest registration, deletion, audit, failover: PASS';

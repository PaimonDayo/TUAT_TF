\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE FUNCTION pg_temp.expect_denied(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE denied boolean:=false; BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>expected THEN RAISE; END IF; denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Required restoration barrier failed'; END IF;
END $$;
DO $$ BEGIN
 IF current_database()<>'tuat_rls_review'
    OR (SELECT count(*) FROM auth.users)<>3 OR (SELECT count(*) FROM public.profiles)<>3
    OR EXISTS(SELECT 1 FROM auth.users WHERE email !~ '@example\.invalid$')
    OR current_setting('cron.launch_active_jobs')<>'off'
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator' AND 'pgrst.db_pre_request=public.check_login_access'=ANY(rolconfig))
    OR EXISTS(SELECT 1 FROM cron.job WHERE active)
    OR (SELECT count(*) FROM public.note_image_cleanup)<>1
    OR NOT EXISTS(SELECT 1 FROM public.confirmed_image_retirements WHERE bucket='avatars' AND path='ba611111-0000-4000-8000-000000000001/retired.webp' AND confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Restore fixture/content/disabled cron mismatch'; END IF;
 IF has_table_privilege('anon','public.profiles','SELECT')
    OR has_table_privilege('authenticated','public.confirmed_image_retirements','SELECT')
    OR has_function_privilege('authenticated','public.claim_confirmed_image_cleanup(text,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.claim_confirmed_image_cleanup(text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Restore permissions mismatch'; END IF;
END $$;
CREATE FUNCTION pg_temp.backup_uuid(family text,n integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('ba611111-0000-4000-'||family||'-'||lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.backup_sha(value text) RETURNS text LANGUAGE sql AS $$
 SELECT md5('backup-a:'||value)||md5('backup-b:'||value);
$$;
CREATE FUNCTION pg_temp.backup_sheet_config(profile uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('sheet_name',sheet_name,'record_fields',record_fields,
   'sheet_transition',sheet_transition,'sheet_header_signature',sheet_header_signature,'record_source',record_source)
 FROM public.profiles WHERE id=profile;
$$;
CREATE FUNCTION pg_temp.backup_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Restored sheet receipt assertion: %',label; END IF; END;
$$;
CREATE FUNCTION pg_temp.backup_begin(n integer,attempt integer,slot text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.sheet_push_begin(pg_temp.backup_uuid('8600',attempt),'record',r.id,r.user_id,r.recorded_date,r.updated_at,
   pg_temp.backup_sheet_config(r.user_id),coalesce(slot,pg_temp.backup_sha('slot-'||n)),pg_temp.backup_sha('target-'||n),pg_temp.backup_sha('payload-'||n))
 FROM public.practice_records r WHERE r.id=pg_temp.backup_uuid('8500',n);
$$;
DO $$ DECLARE role_name text;signature text; BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sheet_push_attempts'::regclass)
    OR (SELECT count(*) FROM public.sheet_push_attempts)<>5 THEN RAISE EXCEPTION 'Restored receipt rows/RLS absent'; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_table_privilege(role_name,'public.sheet_push_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
   RAISE EXCEPTION 'Restored unprivileged receipt table grant'; END IF;
 END LOOP;
 IF NOT has_table_privilege('service_role','public.sheet_push_attempts','SELECT')
    OR has_table_privilege('service_role','public.sheet_push_attempts','INSERT,UPDATE,DELETE,TRUNCATE') THEN
  RAISE EXCEPTION 'Restored service receipt mutation boundary'; END IF;
 FOREACH signature IN ARRAY ARRAY[
  'public.sheet_push_begin(uuid,text,uuid,uuid,date,timestamp with time zone,jsonb,text,text,text)',
  'public.sheet_push_finish(uuid,text,text,boolean)',
  'public.sheet_clear_resolve(uuid,date,timestamp with time zone,jsonb,text)'] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('authenticated',signature,'EXECUTE')
     OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Restored receipt RPC grant'; END IF;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.headers','{}',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"ba611111-0000-4000-8000-000000000001","email":"backup-a@example.invalid"}',true);
DO $$ DECLARE n integer; BEGIN
 IF NOT public.login_access_allowed() OR NOT public.is_member()
    OR (SELECT count(*) FROM public.profiles WHERE id='ba611111-0000-4000-8000-000000000001')<>1 THEN
   RAISE EXCEPTION 'Restored permitted UUID cannot read its profile'; END IF;
 UPDATE public.profiles SET display_name='Restored synthetic save' WHERE id='ba611111-0000-4000-8000-000000000001';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Restored permitted member cannot save'; END IF;
END $$;
SELECT pg_temp.expect_denied($s$UPDATE public.profiles SET avatar_url='ba611111-0000-4000-8000-000000000001/retired.webp' WHERE id='ba611111-0000-4000-8000-000000000001'$s$,'PT409');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"ba611111-0000-4000-8000-000000000002","email":"backup-b@example.invalid"}',true);
DO $$ BEGIN
 IF public.login_access_allowed() OR EXISTS(SELECT 1 FROM public.profiles) THEN
  RAISE EXCEPTION 'Restored denied existing identity can read rows'; END IF;
END $$;
SELECT pg_temp.expect_denied($s$SELECT public.avatar_image_is_retired('ba611111-0000-4000-8000-000000000001/retired.webp')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{}',true);
-- Assert preserved metadata/content before any restored acceptance mutation.
SELECT pg_temp.backup_assert(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE attempt_id=pg_temp.backup_uuid('8600',1)
 AND state='reserved' AND marker_status='pending' AND NOT provider_complete AND created_at=TIMESTAMPTZ '1900-01-01'
 AND confirmed_at IS NULL AND completed_at IS NULL),'unknown reservation has no expiry or invented success');
SELECT pg_temp.backup_assert(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE attempt_id=pg_temp.backup_uuid('8600',2)
 AND state='confirmed' AND marker_status='partial' AND NOT provider_complete AND completed_at IS NULL),'partial evidence retained');
SELECT pg_temp.backup_assert(EXISTS(SELECT 1 FROM public.sheet_push_attempts a JOIN public.practice_records r ON r.id=a.record_id
 WHERE a.attempt_id=pg_temp.backup_uuid('8600',3) AND a.state='completed' AND a.marker_status='applied'
 AND a.provider_complete AND a.marker_version=r.updated_at AND a.marker_version<>a.expected_version
 AND NOT r.pending_sheet_push AND r.synced_at IS NOT NULL),'actual applied marker version retained');
SELECT pg_temp.backup_assert(EXISTS(SELECT 1 FROM public.sheet_push_attempts a JOIN public.practice_records r ON r.id=a.record_id
 WHERE a.attempt_id=pg_temp.backup_uuid('8600',4) AND a.state='completed' AND a.marker_status='superseded'
 AND a.provider_complete AND a.marker_version IS NULL AND r.updated_at<>a.expected_version
 AND r.pending_sheet_push AND r.memo='Synthetic newer superseded edit' AND r.synced_at IS NULL),'newer superseded edit retained');
SELECT pg_temp.backup_assert(EXISTS(SELECT 1 FROM public.sheet_push_attempts a JOIN public.sheet_pending_clears q
 ON q.user_id=a.profile_id AND q.recorded_date=a.recorded_date WHERE a.attempt_id=pg_temp.backup_uuid('8600',5)
 AND a.kind='clear' AND a.state='reserved' AND a.expected_version=q.created_at),'unknown clear and original queue version retained');
SELECT pg_temp.backup_assert(NOT EXISTS(SELECT 1 FROM public.sheet_push_attempts a
 WHERE a.expected_profile<>pg_temp.backup_sheet_config(a.profile_id)
 OR a.profile_fingerprint<>encode(sha256(convert_to(a.expected_profile::text,'UTF8')),'hex')),'raw five-key profile/config fingerprint retained');

-- Real SQL roles enforce table/RPC boundaries after restore, not just ACL shape.
SET LOCAL ROLE anon;
SELECT pg_temp.expect_denied('SELECT * FROM public.sheet_push_attempts','42501');
SELECT pg_temp.expect_denied($s$SELECT public.sheet_push_finish('ba611111-0000-4000-8600-000000000001',repeat('a',64),repeat('b',64),true)$s$,'42501');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_denied('SELECT * FROM public.sheet_push_attempts','42501');
SELECT pg_temp.expect_denied($s$SELECT public.sheet_clear_resolve('ba611111-0000-4000-8000-000000000001',DATE '2099-01-06',clock_timestamp(),'{}',repeat('a',64))$s$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.backup_assert((SELECT count(*) FROM public.sheet_push_attempts)=5,'service can inspect exact retained receipts');
SELECT pg_temp.expect_denied('DELETE FROM public.sheet_push_attempts','42501');
SELECT pg_temp.expect_denied('UPDATE public.sheet_push_attempts SET provider_complete=true','42501');
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SELECT pg_temp.expect_denied($s$SELECT public.sheet_push_finish('ba611111-0000-4000-8600-000000000001',repeat('a',64),repeat('b',64),true)$s$,'42501');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

-- Repeated begin results authorize zero dispatches after restore. New IDs are
-- not permission to repeat a held or already applied version.
SELECT pg_temp.backup_assert(pg_temp.backup_begin(1,1)->>'outcome'='blocked','same unknown ID never sends');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(1,101)->>'outcome'='blocked','new ID/current edit cannot release unknown');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(2,102)->>'outcome'='blocked','partial never resends');
SELECT pg_temp.backup_assert(public.sheet_push_finish(pg_temp.backup_uuid('8600',2),pg_temp.backup_sha('target-2'),pg_temp.backup_sha('payload-2'),true)
 @> '{"outcome":"confirmed","marker_status":"partial"}','partial cannot be promoted by repeated finish');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(3,103) @> '{"outcome":"completed","marker_status":"applied"}','marker version prevents applied resend');
SELECT pg_temp.backup_assert(public.sheet_push_finish(pg_temp.backup_uuid('8600',4),pg_temp.backup_sha('target-4'),pg_temp.backup_sha('payload-4'),true)
 @> '{"outcome":"completed","marker_status":"superseded"}','old superseded receipt stays completed');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(6,106,pg_temp.backup_sha('slot-1'))->>'outcome'='blocked','other permitted profile same day/slot held');
SELECT pg_temp.backup_assert(public.sheet_push_begin(pg_temp.backup_uuid('8600',105),'clear',NULL,pg_temp.backup_uuid('8000',1),DATE '2099-01-06',
 (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.backup_uuid('8000',1) AND recorded_date=DATE '2099-01-06'),
 pg_temp.backup_sheet_config(pg_temp.backup_uuid('8000',1)),pg_temp.backup_sha('slot-5'),pg_temp.backup_sha('target-5'),pg_temp.backup_sha('payload-5'))->>'outcome'='blocked','unknown clear never resends');
SELECT pg_temp.backup_assert((SELECT count(*) FROM public.sheet_push_attempts)=5,'no restored begin created a new dispatch receipt');

-- Unknown record deletion/import and clear resolution cannot erase the barrier.
DELETE FROM public.practice_records WHERE id=pg_temp.backup_uuid('8500',1);
SELECT pg_temp.backup_assert(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE attempt_id=pg_temp.backup_uuid('8600',1) AND state='reserved'),
 'record deletion retains unknown receipt');
SELECT pg_temp.expect_denied($s$INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet,synced_at)
 VALUES('ba611111-0000-4000-8500-000000000099','ba611111-0000-4000-8000-000000000001',DATE '2099-01-02','Synthetic CSV overwrite',true,clock_timestamp())$s$,'PT409');
SELECT pg_temp.expect_denied($s$UPDATE public.practice_records SET memo='Synthetic CSV overwrite',from_sheet=true,synced_at=clock_timestamp(),pending_sheet_push=false
 WHERE id='ba611111-0000-4000-8500-000000000002'$s$,'PT409');
INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet)
 VALUES(pg_temp.backup_uuid('8500',5),pg_temp.backup_uuid('8000',1),DATE '2099-01-06','Synthetic recreated clear record',false);
SELECT pg_temp.backup_assert(public.sheet_clear_resolve(pg_temp.backup_uuid('8000',1),DATE '2099-01-06',
 (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.backup_uuid('8000',1) AND recorded_date=DATE '2099-01-06'),
 pg_temp.backup_sheet_config(pg_temp.backup_uuid('8000',1)),pg_temp.backup_sha('slot-5'))->>'outcome'='blocked','recreated record cannot resolve unknown clear');
SELECT pg_temp.expect_denied($s$DELETE FROM public.sheet_pending_clears WHERE user_id='ba611111-0000-4000-8000-000000000001' AND recorded_date=DATE '2099-01-06'$s$,'PT409');
DELETE FROM public.practice_records WHERE id=pg_temp.backup_uuid('8500',6);
SELECT pg_temp.backup_assert(public.sheet_clear_resolve(pg_temp.backup_uuid('8000',3),DATE '2099-01-02',
 (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.backup_uuid('8000',3) AND recorded_date=DATE '2099-01-02'),
 pg_temp.backup_sheet_config(pg_temp.backup_uuid('8000',3)),pg_temp.backup_sha('slot-1'))->>'outcome'='blocked','cross-profile physical slot also holds clear resolution');
SELECT pg_temp.backup_assert((SELECT count(*) FROM public.sheet_push_attempts)=5,'held evidence unchanged after deletion/recreation');
RESET ROLE;

-- A real later member edit is writable and stays pending when the old receipt
-- is observed again. This is an app DB edit, never an external provider call.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"ba611111-0000-4000-8000-000000000001","email":"backup-a@example.invalid"}',true);
UPDATE public.practice_records SET memo='Synthetic restored later member edit' WHERE id=pg_temp.backup_uuid('8500',3);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.backup_assert(public.sheet_push_finish(pg_temp.backup_uuid('8600',3),pg_temp.backup_sha('target-3'),pg_temp.backup_sha('payload-3'),true)
 @> '{"outcome":"completed","marker_status":"applied"}','repeat old finish remains immutable');
SELECT pg_temp.backup_assert((SELECT pending_sheet_push AND memo='Synthetic restored later member edit' FROM public.practice_records WHERE id=pg_temp.backup_uuid('8500',3)),
 'old completion cannot consume new member edit');
SELECT pg_temp.backup_assert((SELECT pending_sheet_push AND memo='Synthetic newer superseded edit' FROM public.practice_records WHERE id=pg_temp.backup_uuid('8500',4)),
 'superseded newer edit remains pending');
RESET ROLE;
\echo PASS:restored-sheet-receipts-ACL-unknown-dispatch0-marker-slot
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
DELETE FROM public.login_email_allowlist WHERE email='backup-a@example.invalid';
SET LOCAL ROLE authenticated;
SELECT set_config('request.headers','{}',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"ba611111-0000-4000-8000-000000000001","email":"backup-a@example.invalid"}',true);
DO $$ BEGIN
 IF public.login_access_allowed() OR EXISTS(SELECT 1 FROM public.profiles) THEN
  RAISE EXCEPTION 'Restored allowlist revocation failed'; END IF;
END $$;
SELECT pg_temp.expect_denied('SELECT public.check_login_access()','PT403');
ROLLBACK;
\echo PASS:restored-UUID-RLS-allowlist-image-barrier

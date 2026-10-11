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
    OR (SELECT count(*) FROM auth.users)<>2 OR (SELECT count(*) FROM public.profiles)<>2
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

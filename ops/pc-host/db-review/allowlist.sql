-- Actual PostgreSQL / current candidate schema; synthetic fixtures all roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_database() <> 'tuat_rls_review' OR EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'Use the fresh empty synthetic tuat_rls_review database';
  END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.headers', '{"x-tuat-mirror":"1"}', true);
INSERT INTO public.login_email_allowlist(email,created_by) VALUES ('permitted@example.invalid','a6111101-0000-4000-8000-000000000001');
INSERT INTO auth.users(id,email) VALUES
  ('a6111101-0000-4000-8000-000000000001','permitted@example.invalid'),
  ('a6111101-0000-4000-8000-000000000002','denied@example.invalid'),
  ('a6111101-0000-4000-8000-000000000003','synthetic@st.go.tuat.ac.jp');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE id IN ('a6111101-0000-4000-8000-000000000001','a6111101-0000-4000-8000-000000000002','a6111101-0000-4000-8000-000000000003') AND approved AND role='member' AND status='active') <> 3 THEN
    RAISE EXCEPTION 'Auth UUID/profile trigger or normal registration defaults failed';
  END IF;
  IF NOT public.login_email_is_allowed('permitted@example.invalid') OR public.login_email_is_allowed('denied@example.invalid') OR NOT public.login_email_is_allowed('synthetic@st.go.tuat.ac.jp') THEN
    RAISE EXCEPTION 'University/exact external permission failed';
  END IF;
  IF (public.hook_restrict_signup_by_email_domain('{"user":{"email":"permitted@example.invalid"}}')->'error') IS NOT NULL OR
      (public.hook_restrict_signup_by_email_domain('{"user":{"email":"denied@example.invalid"}}')->'error') IS NULL THEN
    RAISE EXCEPTION 'Current real registration hook failed';
  END IF;
END $$;
SELECT set_config('request.headers', '{}', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6111101-0000-4000-8000-000000000001","role":"authenticated","email":"permitted@example.invalid"}',true);
DO $$ DECLARE n integer; BEGIN
  IF NOT public.login_access_allowed() OR (SELECT count(*) FROM public.profiles WHERE id='a6111101-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'Permitted UUID cannot read own profile'; END IF;
  UPDATE public.profiles SET display_name='Synthetic external profile' WHERE id='a6111101-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Permitted external identity cannot save ordinary profile'; END IF;
  BEGIN
    INSERT INTO public.login_email_allowlist(email) VALUES ('escalation@example.invalid');
    RAISE EXCEPTION 'Ordinary member edited the allowlist';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"a6111101-0000-4000-8000-000000000002","role":"authenticated","email":"denied@example.invalid"}',true);
DO $$ BEGIN
  IF public.login_access_allowed() OR EXISTS (SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'Unlisted external session retained row access'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DELETE FROM public.login_email_allowlist WHERE email='permitted@example.invalid';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6111101-0000-4000-8000-000000000001","role":"authenticated","email":"permitted@example.invalid"}',true);
DO $$ BEGIN
  IF public.login_access_allowed() OR EXISTS (SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'Revoked existing session retained row access'; END IF;
  BEGIN
    PERFORM public.check_login_access();
    RAISE EXCEPTION 'Revoked existing session passed pre-request authorization';
  EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM auth.users) <> 3 OR (SELECT count(*) FROM public.profiles) <> 3 THEN RAISE EXCEPTION 'Permission revoke deleted identity or profile'; END IF;
END $$;
ROLLBACK;
\echo PASS: current allowlist, registration hook, UUID/profile provisioning, ordinary save, member-edit denial, unlisted/revoked session RLS, retained identity, rollback

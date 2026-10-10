-- Isolated, synthetic DB only. All fixtures and DDL roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_database() <> 'tuat_rls_review'
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.profile_roles') IS NULL
     OR to_regclass('public.login_email_allowlist') IS NULL
     OR EXISTS (SELECT 1 FROM public.profiles WHERE email !~ '@[^@]+\.invalid$') THEN
    RAISE EXCEPTION 'Use the isolated synthetic tuat_rls_review database';
  END IF;
END $$;
\ir ../migrations/20261011040000_role_profile_guards.sql
\ir ../migrations/20261011040000_role_profile_guards.sql

CREATE FUNCTION pg_temp.expect_rejection(statement text, expected_message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE expected_message THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Required DB protection did not reject the synthetic operation'; END IF;
END $$;

DO $$
DECLARE
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  member_manager uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  callback_id uuid := gen_random_uuid();
  role_a uuid := gen_random_uuid(); role_b uuid := gen_random_uuid();
  manager_role uuid := gen_random_uuid(); normal_role uuid := gen_random_uuid();
  custom_role uuid := gen_random_uuid(); protected_role uuid := gen_random_uuid();
  everyone_role uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '{"x-tuat-mirror":"1"}', true);
  INSERT INTO public.login_email_allowlist(email, created_by) VALUES
    (user_a || '@example.invalid', user_a), (user_b || '@example.invalid', user_b),
    (member_manager || '@example.invalid', member_manager), (member_id || '@example.invalid', member_id),
    (callback_id || '@example.invalid', callback_id),
    ('changed-' || callback_id || '@example.invalid', callback_id);
  -- Existing synthetic seed cannot hide a failure to preserve the final manager.
  UPDATE public.roles SET can_manage_system = false, can_manage_members = false;
  INSERT INTO auth.users(id, email) VALUES
    (user_a, user_a || '@example.invalid'), (user_b, user_b || '@example.invalid'),
    (member_manager, member_manager || '@example.invalid'),
    (member_id, member_id || '@example.invalid'), (callback_id, callback_id || '@example.invalid');
  INSERT INTO public.profiles(id, email, display_name) VALUES
    (user_a, user_a || '@example.invalid', '合成システム管理 A'),
    (user_b, user_b || '@example.invalid', '合成システム管理 B'),
    (member_manager, member_manager || '@example.invalid', '合成部員管理'),
    (member_id, member_id || '@example.invalid', '合成一般部員'),
    (callback_id, callback_id || '@example.invalid', '合成ログイン復旧')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
  DELETE FROM public.profiles WHERE id = callback_id;
  INSERT INTO public.roles(id, name, can_manage_system, can_manage_members, is_system, is_everyone) VALUES
    (role_a, '合成システム A', true, true, false, false),
    (role_b, '合成システム B', true, true, false, false),
    (manager_role, '合成部員管理', false, true, false, false),
    (normal_role, '合成一般', false, false, false, false),
    (custom_role, '合成カスタム', false, false, false, false),
    (protected_role, '合成保護ロール', false, false, true, false);
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE is_everyone) THEN
    INSERT INTO public.roles(id, name, is_everyone) VALUES (everyone_role, '合成全員', true);
  ELSE
    SELECT id INTO everyone_role FROM public.roles WHERE is_everyone;
  END IF;
  INSERT INTO public.profile_roles(profile_id, role_id) VALUES
    (user_a, role_a), (user_b, role_b), (member_manager, manager_role), (member_id, normal_role);
  PERFORM set_config('test.user_a', user_a::text, true);
  PERFORM set_config('test.user_b', user_b::text, true);
  PERFORM set_config('test.manager', member_manager::text, true);
  PERFORM set_config('test.member', member_id::text, true);
  PERFORM set_config('test.callback', callback_id::text, true);
  PERFORM set_config('test.role_a', role_a::text, true);
  PERFORM set_config('test.role_b', role_b::text, true);
  PERFORM set_config('test.manager_role', manager_role::text, true);
  PERFORM set_config('test.normal_role', normal_role::text, true);
  PERFORM set_config('test.custom_role', custom_role::text, true);
  PERFORM set_config('test.protected_role', protected_role::text, true);
  PERFORM set_config('test.everyone_role', everyone_role::text, true);
  PERFORM set_config('request.headers', '{}', true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE member_id uuid := current_setting('test.member')::uuid; n integer;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', member_id, 'role', 'authenticated',
    'email', member_id || '@example.invalid')::text, true);
  UPDATE public.profiles SET display_name = '合成変更後', blocks = ARRAY['middle_long'], grade = 'M1',
    avatar_url = member_id || '/synthetic.webp', goal = '合成目標', events = ARRAY['1500m'],
    notify_comment = false, notify_notice = false, notify_mention = false,
    menu_view_all_blocks = true, attendance_view_all_blocks = true,
    attendance_default_block = 'middle_long', timeline_default_block = 'middle_long',
    schedule_view_all_blocks = true, record_fields = '[{"key":"synthetic","label":"合成"}]'::jsonb,
    sheet_header_signature = 'synthetic-signature'
  WHERE id = member_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Own profile settings could not be saved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = member_id AND grade = 'M1'
    AND blocks = ARRAY['middle_long'] AND record_fields_version = 2) THEN
    RAISE EXCEPTION 'Own settings or form versioning were lost';
  END IF;
  PERFORM public.save_october_sheet_setup('合成スプレッドシート', '[]'::jsonb, 'synthetic-signature', 'app_only');
  PERFORM public.save_october_sheet_setup('合成スプレッドシート', '[]'::jsonb, 'synthetic-signature', 'off');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET approved=false WHERE id=%L', member_id),
    'member management permission required');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET status=%L WHERE id=%L', 'graduated', member_id),
    'member management permission required');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET mention_reading=%L WHERE id=%L', 'ごうせい', member_id),
    'system management permission required');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET role=%L WHERE id=%L', 'admin', member_id),
    'profile identity fields require service management');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET id=%L WHERE id=%L', gen_random_uuid(), member_id),
    'profile identity fields require service management');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET created_at=created_at - interval %L WHERE id=%L', '1 day', member_id),
    'profile identity fields require service management');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET email=%L WHERE id=%L', 'other@example.invalid', member_id),
    'profile email must match the authenticated account');
  -- A mirror header by itself must not authorize an ordinary user.
  PERFORM set_config('request.headers', '{"x-tuat-mirror":"1"}', true);
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET approved=false WHERE id=%L', member_id),
    'member management permission required');
  PERFORM set_config('request.headers', '{}', true);
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_member_approved(%L,false)', member_id),
    'member management permission required');
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_profile_mention_reading(%L,%L)', member_id, 'ごうせい'),
    'system management permission required');
END $$;

DO $$
DECLARE callback_id uuid := current_setting('test.callback')::uuid; callback_email text;
BEGIN
  callback_email := callback_id || '@example.invalid';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', callback_id, 'role', 'authenticated',
    'email', callback_email)::text, true);
  PERFORM pg_temp.expect_rejection(format('INSERT INTO public.profiles(id,email,approved) VALUES(%L,%L,false)', callback_id, callback_email),
    'new profiles must use the normal registration defaults');
  PERFORM pg_temp.expect_rejection(format('INSERT INTO public.profiles(id,email,role) VALUES(%L,%L,%L)', callback_id, callback_email, 'admin'),
    'new profiles must use the normal registration defaults');
  PERFORM pg_temp.expect_rejection(format('INSERT INTO public.profiles(id,email,status) VALUES(%L,%L,%L)', callback_id, callback_email, 'graduated'),
    'new profiles must use the normal registration defaults');
  PERFORM pg_temp.expect_rejection(format('INSERT INTO public.profiles(id,email,mention_reading) VALUES(%L,%L,%L)', callback_id, callback_email, 'ごうせい'),
    'new profiles must use the normal registration defaults');
  PERFORM pg_temp.expect_rejection(format('INSERT INTO public.profiles(id,email) VALUES(%L,%L)', callback_id, 'other@example.invalid'),
    'profile identity must match the authenticated account');
  INSERT INTO public.profiles(id,email) VALUES(callback_id, callback_email)
  ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id, email=EXCLUDED.email;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=callback_id AND approved AND status='active' AND role='member') THEN
    RAISE EXCEPTION 'Callback registration no longer automatically approves the normal profile';
  END IF;
  callback_email := 'changed-' || callback_id || '@example.invalid';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', callback_id, 'role', 'authenticated',
    'email', callback_email)::text, true);
  INSERT INTO public.profiles(id,email) VALUES(callback_id, callback_email)
  ON CONFLICT (id) DO UPDATE SET id=EXCLUDED.id, email=EXCLUDED.email;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=callback_id AND email=callback_email) THEN
    RAISE EXCEPTION 'Signed account email could not be synchronized by callback upsert';
  END IF;
END $$;

DO $$
DECLARE manager_id uuid := current_setting('test.manager')::uuid; member_id uuid := current_setting('test.member')::uuid;
  custom_role uuid := current_setting('test.custom_role')::uuid; n integer;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', manager_id, 'role', 'authenticated',
    'email', manager_id || '@example.invalid')::text, true);
  UPDATE public.profiles SET approved=false, status='graduated' WHERE id=member_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Member manager could not change member state'; END IF;
  PERFORM public.set_member_approved(member_id, true);
  UPDATE public.profiles SET status='active' WHERE id=member_id;
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET mention_reading=%L WHERE id=%L', 'ごうせい', member_id),
    'system management permission required');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.profiles SET email=%L WHERE id=%L', manager_id || '@example.invalid', member_id),
    'profile email must match the authenticated account');
  UPDATE public.roles SET name='合成カスタム変更後', color='#123456', can_create_menu=true WHERE id=custom_role;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Custom role editing was lost'; END IF;
  PERFORM pg_temp.expect_rejection(format('UPDATE public.roles SET is_system=true WHERE id=%L', custom_role), 'role protection cannot be changed');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.roles SET is_system=false WHERE id=%L', current_setting('test.protected_role')), 'role protection cannot be changed');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.roles SET is_everyone=false WHERE id=%L', current_setting('test.everyone_role')), '%cannot be converted');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.roles SET is_everyone=true WHERE id=%L', custom_role), 'role protection cannot be changed');
  PERFORM pg_temp.expect_rejection('INSERT INTO public.roles(name,is_system) VALUES(''合成拒否'',true)', 'protected roles cannot be created by this operation');
  PERFORM pg_temp.expect_rejection(format('UPDATE public.roles SET can_manage_system=true WHERE id=%L', custom_role), 'system management permission required');
  PERFORM pg_temp.expect_rejection(format('DELETE FROM public.roles WHERE id=%L', current_setting('test.role_b')), 'system management permission required');
  DELETE FROM public.roles WHERE id IN (current_setting('test.protected_role')::uuid, current_setting('test.everyone_role')::uuid);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Protected role was deleted'; END IF;
  PERFORM pg_temp.expect_rejection(format('SELECT public.delete_custom_role(%L)', current_setting('test.everyone_role')), 'protected roles cannot be deleted');
  PERFORM pg_temp.expect_rejection(format('SELECT public.delete_custom_role(%L)', current_setting('test.protected_role')), 'protected roles cannot be deleted');
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_profile_roles(%L,ARRAY[%L]::uuid[])', current_setting('test.user_b'), current_setting('test.role_a')),
    'system management permission required');
  PERFORM public.set_profile_roles(member_id, ARRAY[current_setting('test.normal_role')::uuid, custom_role]);
  PERFORM public.set_role_members(custom_role, ARRAY[member_id, current_setting('test.callback')::uuid]);
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles WHERE profile_id=member_id AND role_id=current_setting('test.normal_role')::uuid) THEN
    RAISE EXCEPTION 'Role member editing removed another role';
  END IF;
  IF NOT public.delete_custom_role(custom_role) THEN RAISE EXCEPTION 'Custom role deletion failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles WHERE profile_id=member_id AND role_id=current_setting('test.normal_role')::uuid) THEN
    RAISE EXCEPTION 'Role deletion removed an unrelated assignment';
  END IF;
END $$;

DO $$
DECLARE user_a uuid := current_setting('test.user_a')::uuid; role_a uuid := current_setting('test.role_a')::uuid;
  user_b uuid := current_setting('test.user_b')::uuid; role_b uuid := current_setting('test.role_b')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated',
    'email', user_a || '@example.invalid')::text, true);
  PERFORM public.set_profile_mention_reading(current_setting('test.member')::uuid, 'ごうせい');
  PERFORM public.set_profile_roles(user_b, '{}'::uuid[]);
  PERFORM pg_temp.expect_rejection(format('UPDATE public.roles SET can_manage_system=false WHERE id=%L', role_a), 'cannot remove the last system manager role');
  PERFORM pg_temp.expect_rejection(format('DELETE FROM public.roles WHERE id=%L', role_a), 'cannot remove the last system manager role');
  PERFORM pg_temp.expect_rejection(format('SELECT public.delete_custom_role(%L)', role_a), 'cannot remove the last system manager role');
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_profile_roles(%L,%L::uuid[])', user_a, '{}'), 'cannot remove the last system manager');
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_role_members(%L,%L::uuid[])', role_a, '{}'), 'cannot remove the last system manager');
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_role_members(%L,ARRAY[%L]::uuid[])', role_a, gen_random_uuid()), 'profile not found');
  PERFORM pg_temp.expect_rejection(format('SELECT public.set_profile_roles(%L,ARRAY[%L]::uuid[])', user_a, gen_random_uuid()), 'role not found');
  PERFORM public.set_profile_roles(user_b, ARRAY[role_b]);
  UPDATE public.roles SET can_manage_system=false WHERE id=role_b;
  UPDATE public.roles SET can_manage_system=true WHERE id=role_b;
  DELETE FROM public.roles WHERE id=role_b;
  IF NOT EXISTS (SELECT 1 FROM public.profile_roles WHERE profile_id=user_a AND role_id=role_a)
     OR EXISTS (SELECT 1 FROM public.profile_roles WHERE role_id=role_b) THEN
    RAISE EXCEPTION 'Safe system-role deletion did not preserve the other manager';
  END IF;
END $$;

RESET ROLE;
DO $$
DECLARE member_id uuid := current_setting('test.member')::uuid; auth_id uuid := gen_random_uuid();
BEGIN
  -- Normal service jobs can maintain private identity/state fields without a mirror header.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '{}', true);
  UPDATE public.profiles SET email='service-' || member_id || '@example.invalid', role='menu_staff',
    approved=false, status='graduated', mention_reading='しごと' WHERE id=member_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=member_id AND NOT approved AND role='menu_staff'
    AND mention_reading='しごと') THEN RAISE EXCEPTION 'Service profile maintenance was blocked'; END IF;
  -- Mirror replay still reproduces source protection flags verbatim.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '{"x-tuat-mirror":"1"}', true);
  UPDATE public.roles SET is_system=false WHERE id=current_setting('test.protected_role')::uuid;
  UPDATE public.roles SET is_system=true WHERE id=current_setting('test.protected_role')::uuid;
  INSERT INTO public.login_email_allowlist(email, created_by) VALUES(auth_id || '@example.invalid', auth_id);
  PERFORM set_config('test.auth_created', auth_id::text, true);
END $$;

-- GoTrue's original DB login must work without request claims, including inside
-- its SECURITY DEFINER account trigger. Check the profile as the original DB operator.
SET LOCAL SESSION AUTHORIZATION supabase_auth_admin;
DO $$ DECLARE auth_id uuid := current_setting('test.auth_created')::uuid; BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
  IF public.hook_restrict_signup_by_email_domain(jsonb_build_object('user',
    jsonb_build_object('email', auth_id || '@example.invalid'))) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'Synthetic Auth registration was not explicitly whitelisted';
  END IF;
  INSERT INTO auth.users(id,email) VALUES(auth_id, auth_id || '@example.invalid');
  PERFORM set_config('test.auth_created', auth_id::text, true);
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=current_setting('test.auth_created')::uuid
    AND approved AND status='active' AND role='member') THEN
    RAISE EXCEPTION 'Auth account registration no longer creates an automatically approved profile';
  END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '{"x-tuat-mirror":"1"}', true);
  DELETE FROM public.login_email_allowlist
  WHERE created_by IN (current_setting('test.user_a')::uuid, current_setting('test.user_b')::uuid,
    current_setting('test.manager')::uuid, current_setting('test.member')::uuid,
    current_setting('test.callback')::uuid, current_setting('test.auth_created')::uuid)
    AND email IN (current_setting('test.user_a') || '@example.invalid', current_setting('test.user_b') || '@example.invalid',
      current_setting('test.manager') || '@example.invalid', current_setting('test.member') || '@example.invalid',
      current_setting('test.callback') || '@example.invalid', 'changed-' || current_setting('test.callback') || '@example.invalid',
      current_setting('test.auth_created') || '@example.invalid');
END $$;
ROLLBACK;
\echo PASS: profile boundaries, callback email recovery, auto approval, custom roles, final manager, service jobs, mirror replay, idempotency, rollback

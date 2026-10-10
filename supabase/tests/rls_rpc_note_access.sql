-- psql -X -v ON_ERROR_STOP=1 -d tuat_rls_review -f supabase/tests/rls_rpc_note_access.sql
-- Isolated synthetic DB only. Every fixture, cursor change, and migration rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_database() <> 'tuat_rls_review' THEN
    RAISE EXCEPTION 'Use the isolated tuat_rls_review database';
  END IF;
END $$;

CREATE TEMP TABLE rpc_acl_before AS
SELECT p.oid::regprocedure AS fn,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');

\ir ../migrations/20261011030000_rpc_and_note_access.sql
\ir ../migrations/20261011030000_rpc_and_note_access.sql

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM rpc_acl_before b
    WHERE b.fn NOT IN ('public.claim_sheet_sync_chunk(integer,boolean)'::regprocedure,
      'public.reset_sheet_sync_cursor()'::regprocedure)
      AND (b.authenticated_execute IS DISTINCT FROM has_function_privilege('authenticated', b.fn, 'EXECUTE')
        OR b.service_execute IS DISTINCT FROM has_function_privilege('service_role', b.fn, 'EXECUTE'))
  ) THEN RAISE EXCEPTION 'Authenticated/service function privileges changed'; END IF;
  IF EXISTS (
    SELECT 1 FROM rpc_acl_before b WHERE has_function_privilege('anon', b.fn, 'EXECUTE')
  ) THEN RAISE EXCEPTION 'Anonymous SECURITY DEFINER execution remains'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['public.claim_sheet_sync_chunk(integer,boolean)'::regprocedure,
      'public.reset_sheet_sync_cursor()'::regprocedure]) fn
    WHERE has_function_privilege('authenticated', fn, 'EXECUTE')
      OR NOT has_function_privilege('service_role', fn, 'EXECUTE')
  ) THEN RAISE EXCEPTION 'Sync RPC privileges are incorrect'; END IF;
  IF has_table_privilege('anon', 'public.notes', 'SELECT') THEN
    RAISE EXCEPTION 'Anonymous notes SELECT privilege remains';
  END IF;
END $$;

-- Mirrors use this existing service-only marker to suppress fixture notifications.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.headers', '{"x-tuat-mirror":"1"}', true);
INSERT INTO auth.users(id, email)
SELECT ('a6101101-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'rls-access-' || n || '@example.invalid' FROM generate_series(1, 5) n;
INSERT INTO public.profiles(id, email, display_name, approved, status, sheet_name)
SELECT ('a6101101-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'rls-access-' || n || '@example.invalid', 'Synthetic RLS actor ' || n,
  true, 'active', CASE WHEN n <= 2 THEN 'Synthetic RLS sheet ' || n ELSE NULL END
FROM generate_series(1, 5) n
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name,
  approved = EXCLUDED.approved, status = EXCLUDED.status, sheet_name = EXCLUDED.sheet_name;
-- The login gate checks the verified JWT email, so allow only these synthetic actors.
INSERT INTO public.login_email_allowlist(email, created_by)
SELECT 'rls-access-' || n || '@example.invalid',
  ('a6101101-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
FROM generate_series(1, 5) n;
INSERT INTO public.roles(id, name, can_manage_system, can_manage_members) VALUES
  ('a6101101-0000-4000-8100-000000000001', 'Synthetic RLS system manager', true, false),
  ('a6101101-0000-4000-8100-000000000002', 'Synthetic RLS member manager', false, true);
INSERT INTO public.profile_roles(profile_id, role_id) VALUES
  ('a6101101-0000-4000-8000-000000000004', 'a6101101-0000-4000-8100-000000000001'),
  ('a6101101-0000-4000-8000-000000000005', 'a6101101-0000-4000-8100-000000000002');
INSERT INTO public.notes(id, author_id, scope, title, body, status, edit_policy) VALUES
  ('a6101101-0000-4000-8200-000000000001', 'a6101101-0000-4000-8000-000000000001',
    'shared', 'Synthetic specified draft', 'Synthetic legacy body', 'draft', 'specified'),
  ('a6101101-0000-4000-8200-000000000002', 'a6101101-0000-4000-8000-000000000001',
    'personal', 'Synthetic personal draft', '', 'draft', 'author'),
  ('a6101101-0000-4000-8200-000000000003', 'a6101101-0000-4000-8000-000000000001',
    'personal', 'Synthetic published note', '', 'published', 'author'),
  ('a6101101-0000-4000-8200-000000000004', 'a6101101-0000-4000-8000-000000000001',
    'shared', 'Synthetic everyone draft', '', 'draft', 'everyone');
INSERT INTO public.note_editors(note_id, user_id) VALUES
  ('a6101101-0000-4000-8200-000000000001', 'a6101101-0000-4000-8000-000000000003');
INSERT INTO public.note_articles(id, note_id, author_id, title, body, poll_anonymous)
SELECT ('a6101101-0000-4000-8300-' || lpad(n::text, 12, '0'))::uuid,
  ('a6101101-0000-4000-8200-' || lpad(n::text, 12, '0'))::uuid,
  'a6101101-0000-4000-8000-000000000001'::uuid,
  'Synthetic article ' || n, 'Synthetic article body', false
FROM unnest(ARRAY[1, 3]) n;
INSERT INTO public.note_poll_options(id, article_id, text, created_by) VALUES
  ('a6101101-0000-4000-8400-000000000001', 'a6101101-0000-4000-8300-000000000001',
    'Synthetic private option', 'a6101101-0000-4000-8000-000000000001'),
  ('a6101101-0000-4000-8400-000000000003', 'a6101101-0000-4000-8300-000000000003',
    'Synthetic public option', 'a6101101-0000-4000-8000-000000000001');
INSERT INTO public.note_poll_votes(option_id, user_id) VALUES
  ('a6101101-0000-4000-8400-000000000003', 'a6101101-0000-4000-8000-000000000002');
INSERT INTO public.tweets(id, user_id, content, poll_anonymous) VALUES
  ('a6101101-0000-4000-8500-000000000001', 'a6101101-0000-4000-8000-000000000001', 'Synthetic named poll', false),
  ('a6101101-0000-4000-8500-000000000002', 'a6101101-0000-4000-8000-000000000001', 'Synthetic anonymous poll', true);
INSERT INTO public.tweet_poll_options(id, tweet_id, text, created_by) VALUES
  ('a6101101-0000-4000-8600-000000000001', 'a6101101-0000-4000-8500-000000000001',
    'Synthetic named option', 'a6101101-0000-4000-8000-000000000001'),
  ('a6101101-0000-4000-8600-000000000002', 'a6101101-0000-4000-8500-000000000002',
    'Synthetic anonymous option', 'a6101101-0000-4000-8000-000000000001');
INSERT INTO public.tweet_poll_votes(option_id, user_id) VALUES
  ('a6101101-0000-4000-8600-000000000001', 'a6101101-0000-4000-8000-000000000002'),
  ('a6101101-0000-4000-8600-000000000002', 'a6101101-0000-4000-8000-000000000002');
INSERT INTO public.comments(user_id, target_type, target_id, content) VALUES
  ('a6101101-0000-4000-8000-000000000002', 'tweet',
    'a6101101-0000-4000-8500-000000000001', 'Synthetic comment');
INSERT INTO public.likes(user_id, target_type, target_id) VALUES
  ('a6101101-0000-4000-8000-000000000002', 'tweet', 'a6101101-0000-4000-8500-000000000001');

-- Check body authorization separately from function ACLs as the DB owner.
SELECT set_config('request.headers', '{}', true);
DO $$ DECLARE actor_claims text;
BEGIN
  FOREACH actor_claims IN ARRAY ARRAY['{"role":"anon"}',
    '{"role":"authenticated","sub":"a6101101-0000-4000-8000-000000000002","email":"rls-access-2@example.invalid"}'] LOOP
    PERFORM set_config('request.jwt.claims', actor_claims, true);
    BEGIN
      PERFORM public.claim_sheet_sync_chunk(1, false);
      RAISE EXCEPTION 'Sync claim body accepted a non-service actor';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM public.reset_sheet_sync_cursor();
      RAISE EXCEPTION 'Sync reset body accepted a non-service actor';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  IF public.can_view_note('a6101101-0000-4000-8200-000000000003') THEN
    RAISE EXCEPTION 'Note helper body allowed anonymous published-note access';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$ DECLARE query text;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.notes WHERE id::text LIKE 'a6101101-%') THEN
      RAISE EXCEPTION 'Anonymous notes were visible';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOREACH query IN ARRAY ARRAY[
    'SELECT public.can_view_note(''a6101101-0000-4000-8200-000000000003'')',
    'SELECT * FROM public.count_comments_by_target(''tweet'', ARRAY[]::uuid[])',
    'SELECT * FROM public.get_feed_social_state(ARRAY[]::uuid[], ARRAY[]::uuid[])',
    'SELECT * FROM public.get_tweet_feed_extras(ARRAY[]::uuid[])',
    'SELECT * FROM public.get_poll_results(ARRAY[]::uuid[])',
    'SELECT * FROM public.get_poll_voters(ARRAY[]::uuid[])',
    'SELECT * FROM public.get_note_poll_options(ARRAY[]::uuid[])',
    'SELECT public.claim_sheet_sync_chunk(1, false)',
    'SELECT public.reset_sheet_sync_cursor()'
  ] LOOP
    BEGIN
      EXECUTE query;
      RAISE EXCEPTION 'Anonymous RPC was accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$ DECLARE actor record; actual integer[]; query text; social record; extras record;
  tweet_ids uuid[] := ARRAY['a6101101-0000-4000-8500-000000000001'::uuid, 'a6101101-0000-4000-8500-000000000002'::uuid];
BEGIN
  FOR actor IN SELECT * FROM (VALUES
    (1, ARRAY[1,2,3,4]), -- Author.
    (2, ARRAY[3,4]),     -- Published and everyone-editable draft.
    (3, ARRAY[1,3,4]),   -- Designated editor.
    (4, ARRAY[1,2,3,4]), -- System manager without member-management permission.
    (5, ARRAY[1,2,3,4])  -- Existing member manager.
  ) cases(n, expected) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated',
      'sub', 'a6101101-0000-4000-8000-' || lpad(actor.n::text, 12, '0'),
      'email', 'rls-access-' || actor.n || '@example.invalid')::text, true);
    IF NOT public.login_access_allowed() THEN RAISE EXCEPTION 'Synthetic actor % failed the login gate', actor.n; END IF;
    SELECT coalesce(array_agg(right(id::text, 12)::integer ORDER BY id), '{}') INTO actual
    FROM public.notes WHERE id::text LIKE 'a6101101-%';
    IF actual IS DISTINCT FROM actor.expected THEN RAISE EXCEPTION 'Note visibility changed for actor %', actor.n; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"a6101101-0000-4000-8000-000000000002","email":"rls-access-2@example.invalid"}', true);
  FOREACH query IN ARRAY ARRAY['SELECT public.claim_sheet_sync_chunk(1, false)',
    'SELECT public.reset_sheet_sync_cursor()'] LOOP
    BEGIN EXECUTE query; RAISE EXCEPTION 'Authenticated actor could execute a sync RPC';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  IF (SELECT count FROM public.count_comments_by_target('tweet', ARRAY[tweet_ids[1]])) IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'Comment count changed';
  END IF;
  SELECT * INTO social FROM public.get_feed_social_state('{}', ARRAY[tweet_ids[1]]);
  IF social.comments_count IS DISTINCT FROM 1::bigint OR social.liked_by_me IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Authenticated social state changed';
  END IF;
  IF (SELECT count(*) FROM public.get_poll_results(tweet_ids) WHERE vote_count=1 AND voted_by_me) <> 2 THEN
    RAISE EXCEPTION 'Authenticated vote counts changed';
  END IF;
  IF (SELECT count(*) FROM public.get_poll_voters(tweet_ids)) <> 1 THEN
    RAISE EXCEPTION 'Named/anonymous voter visibility changed';
  END IF;
  FOR extras IN SELECT * FROM public.get_tweet_feed_extras(tweet_ids) LOOP
    IF jsonb_array_length(extras.options) <> 1
      OR (extras.options->0->>'vote_count')::integer <> 1
      OR jsonb_array_length(extras.options->0->'voters') <> (CASE WHEN extras.tweet_id = tweet_ids[1] THEN 1 ELSE 0 END)
      THEN RAISE EXCEPTION 'Tweet poll extras changed'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.get_note_poll_options(ARRAY['a6101101-0000-4000-8300-000000000001'::uuid])) <> 0 THEN
    RAISE EXCEPTION 'Private draft poll exposed to an unrelated member';
  END IF;
  SELECT * INTO extras FROM public.get_note_poll_options(ARRAY['a6101101-0000-4000-8300-000000000003'::uuid]);
  IF jsonb_array_length(extras.options) IS DISTINCT FROM 1
    OR (extras.options->0->>'vote_count')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Published note poll access changed';
  END IF;
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"a6101101-0000-4000-8000-000000000003","email":"rls-access-3@example.invalid"}', true);
  IF (SELECT count(*) FROM public.get_note_poll_options(ARRAY['a6101101-0000-4000-8300-000000000001'::uuid])) <> 1 THEN
    RAISE EXCEPTION 'Designated editor lost draft poll access';
  END IF;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
DO $$ DECLARE claimed jsonb; social record;
BEGIN
  PERFORM public.reset_sheet_sync_cursor();
  claimed := public.claim_sheet_sync_chunk(1, false);
  IF (claimed->>'startOffset')::integer IS DISTINCT FROM 0
    OR (claimed->>'endOffset')::integer IS DISTINCT FROM 1
    OR jsonb_array_length(claimed->'sheetNames') IS DISTINCT FROM 1
    OR (claimed->>'totalMembers')::integer < 2 THEN RAISE EXCEPTION 'Service sync chunk changed'; END IF;
  IF (SELECT next_offset FROM public.sheet_sync_state WHERE sync_key='practice_records') <> 1 THEN
    RAISE EXCEPTION 'Service sync did not advance the cursor';
  END IF;
  PERFORM public.reset_sheet_sync_cursor();
  IF (SELECT next_offset FROM public.sheet_sync_state WHERE sync_key='practice_records') <> 0 THEN
    RAISE EXCEPTION 'Service sync reset failed';
  END IF;
  SELECT * INTO social FROM public.get_feed_social_state('{}', ARRAY['a6101101-0000-4000-8500-000000000001'::uuid]);
  IF social.comments_count IS DISTINCT FROM 1::bigint THEN RAISE EXCEPTION 'Service social reads changed'; END IF;
  IF (SELECT count(*) FROM public.get_tweet_feed_extras(ARRAY['a6101101-0000-4000-8500-000000000001'::uuid])) <> 1 THEN
    RAISE EXCEPTION 'Service tweet reads changed';
  END IF;
  IF (SELECT count(*) FROM public.get_note_poll_options(ARRAY['a6101101-0000-4000-8300-000000000003'::uuid])) <> 1 THEN
    RAISE EXCEPTION 'Service published-note reads changed';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo PASS: idempotency, ACL preservation, anonymous denial, sync ACL/body denial, service sync/read access, note roles, social/poll behavior, rollback

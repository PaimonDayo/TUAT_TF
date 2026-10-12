-- Owned, restored synthetic database only; never a production migration.
\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE active_jobs bigint; BEGIN
  IF current_database()<>'tuat_rls_review' OR
     current_setting('tuat.review.minimal_clone',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Explicit owned restored clone required';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM cron.job WHERE active' INTO active_jobs;
    IF active_jobs<>0 THEN RAISE EXCEPTION 'Legacy jobs must already be inactive'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN
    ('information_schema','public','auth','storage','pc_ops','extensions','vault','net',
     '_realtime','graphql','graphql_public','realtime','pgbouncer','supabase_functions','supabase_migrations','cron')) THEN
    RAISE EXCEPTION 'Unreviewed namespace in clone';
  END IF;
END $$;
-- The caller already restored/verified the complete encrypted rollback archive
-- and retains the untouched source. Any lost core object/data fails comparison.
DROP EXTENSION IF EXISTS pg_cron CASCADE;
DROP EXTENSION IF EXISTS pg_net CASCADE;
DROP EXTENSION IF EXISTS supabase_vault CASCADE;
DROP SCHEMA IF EXISTS cron CASCADE;
DROP SCHEMA IF EXISTS net CASCADE;
DROP SCHEMA IF EXISTS vault CASCADE;
DROP SCHEMA IF EXISTS _realtime CASCADE;
DROP SCHEMA IF EXISTS graphql_public CASCADE;
DROP SCHEMA IF EXISTS graphql CASCADE;
DROP SCHEMA IF EXISTS realtime CASCADE;
DROP SCHEMA IF EXISTS pgbouncer CASCADE;
DROP SCHEMA IF EXISTS supabase_functions CASCADE;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
COMMIT;

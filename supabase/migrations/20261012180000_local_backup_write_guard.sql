-- Install on primary and backup with read_only=false. Activate only on the backup,
-- after snapshot/dryRun and synthetic validation; this migration does not switch production.
-- RLS alone cannot reject service_role or SECURITY DEFINER writes.
BEGIN;

CREATE SCHEMA IF NOT EXISTS pc_ops;
REVOKE ALL ON SCHEMA pc_ops FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS pc_ops.backup_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  read_only boolean NOT NULL DEFAULT false
);
REVOKE ALL ON pc_ops.backup_policy FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO pc_ops.backup_policy(singleton, read_only) VALUES (true, false) ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.backup_read_only()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce((SELECT read_only FROM pc_ops.backup_policy WHERE singleton), false);
$$;
REVOKE ALL ON FUNCTION public.backup_read_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backup_read_only() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pc_ops.guard_backup_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.backup_read_only() AND NOT public.is_mirror_write() AND NOT (
    session_user IN ('postgres','supabase_admin','cli_login_postgres')
    AND coalesce(current_setting('pc_ops.restore', true), '') = 'on'
  ) THEN
    RAISE EXCEPTION 'サーバー停止中のため保存できません。サーバー復帰後にもう一度操作してください。'
      USING ERRCODE='55000';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION pc_ops.guard_backup_writes() FROM PUBLIC, anon, authenticated, service_role;

DO $$ DECLARE relation record; BEGIN
  FOR relation IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','storage')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS pc_backup_read_only ON %I.%I', relation.nspname, relation.relname);
    EXECUTE format('CREATE TRIGGER pc_backup_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.guard_backup_writes()', relation.nspname, relation.relname);
  END LOOP;
END $$;

-- Cloud Auth remains writable for login/refresh/identity management, but it must
-- not implicitly write an application profile on the read-only backup.
-- The existing callback creates the same-ID primary user after recovery.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.backup_read_only() THEN RETURN NEW; END IF;
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Push RPCs and their Vault configuration do not touch an application table,
-- so the table trigger cannot protect direct calls to the backup's PostgREST.
CREATE OR REPLACE FUNCTION public.assert_primary_writable()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.backup_read_only() THEN
    RAISE EXCEPTION 'サーバー停止中のため保存できません。サーバー復帰後にもう一度操作してください。'
      USING ERRCODE='55000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_primary_writable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_primary_writable() TO authenticated, service_role;

-- Preserve the current implementation, owner, ACL, return type and settings.
-- Only insert the guard at its entry; do not duplicate Vault/Push logic here.
DO $$ DECLARE routine record; guarded_source text; found integer := 0; expected integer := 2; BEGIN
  IF to_regprocedure('public.configure_push_webhook_secret(text)') IS NOT NULL THEN expected := expected + 1; END IF;
  FOR routine IN
    SELECT p.oid, p.prosrc, l.lanname, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid IN (to_regprocedure('public.send_test_push()'), to_regprocedure('public.send_test_push_to_subscription(text)'), to_regprocedure('public.configure_push_webhook_secret(text)'))
  LOOP
    found := found + 1;
    IF position('public.assert_primary_writable()' in routine.prosrc) > 0 THEN CONTINUE; END IF;
    IF routine.lanname='plpgsql' THEN
      guarded_source := regexp_replace(routine.prosrc, '\mBEGIN\M', E'BEGIN\n  PERFORM public.assert_primary_writable();');
      IF guarded_source=routine.prosrc THEN RAISE EXCEPTION 'Push RPC entry was not found'; END IF;
    ELSIF routine.lanname='sql' THEN
      -- The isolated synthetic fixture implements disabled Push RPCs in SQL.
      guarded_source := E'SELECT public.assert_primary_writable();\n' || routine.prosrc;
    ELSE RAISE EXCEPTION 'Unexpected Push RPC language'; END IF;
    EXECUTE replace(routine.definition, routine.prosrc, guarded_source);
  END LOOP;
  IF found<>expected THEN RAISE EXCEPTION 'Both current Push RPC definitions are required'; END IF;
END $$;

COMMIT;

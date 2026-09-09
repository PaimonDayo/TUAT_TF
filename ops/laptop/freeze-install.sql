BEGIN;
CREATE SCHEMA IF NOT EXISTS pc_ops;
REVOKE ALL ON SCHEMA pc_ops FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS pc_ops.control (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), frozen boolean NOT NULL DEFAULT false);
REVOKE ALL ON pc_ops.control FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO pc_ops.control(singleton,frozen) VALUES(true,false) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION pc_ops.guard_writes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF (SELECT frozen FROM pc_ops.control WHERE singleton) AND NOT (
    session_user IN ('postgres','supabase_admin','cli_login_postgres') AND coalesce(current_setting('pc_ops.restore',true),'')='on'
  ) THEN RAISE EXCEPTION 'データ移行中です。少し待ってから再度お試しください。' USING ERRCODE='55000'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION pc_ops.guard_writes() FROM PUBLIC, anon, authenticated, service_role;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND (n.nspname='public' OR (n.nspname='auth' AND c.relname IN ('users','identities')))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS pc_guard_writes ON %I.%I',r.nspname,r.relname);
    EXECUTE format('CREATE TRIGGER pc_guard_writes BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.guard_writes()',r.nspname,r.relname);
  END LOOP;
END $$;
COMMIT;

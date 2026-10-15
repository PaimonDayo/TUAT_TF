-- Operator-only final source fence. Never run as an application migration.
-- Root must first verify both source identities, take protected snapshots, and
-- run this entire file with its final COMMIT changed to ROLLBACK for dryRun.
-- Bind these session settings on the SAME connection before this transaction:
--   tuat.final_freeze.expected_system_identifier  (read-only pg_control_system)
--   tuat.final_freeze.forbidden_system_identifier (the new candidate's SYS)
--   tuat.final_freeze.expected_inventory_md5       (query below, before dryRun)
--   tuat.final_freeze.generation                   (fresh UUID)
--   tuat.final_freeze.target_kind                  (old-primary | cloud-auth)
-- Inventory query (no member rows):
-- SELECT md5(coalesce(string_agg(format('%I.%I:%s', n.nspname,c.relname,c.relkind),
--   E'\n' ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),''))
-- FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
-- WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
--
-- Scope: existing ordinary/partitioned tables in public/storage/ALL auth,
-- including auth.schema_migrations. Login, refresh and Auth audit writes stop.
-- BEFORE STATEMENT + ALWAYS also rejects zero-row writes and replica-mode
-- writes by a DB owner. There is NO mirror/service-role/restore exception.
-- Administrators who can ALTER/DROP triggers can deliberately remove a fence.
-- This does not fence sequences, schema DDL, Vault/net/provider side effects,
-- R2 or other direct external calls. Root must fence old entries and drain
-- Jobs/mirror separately, prevent concurrent schema DDL, and recheck inventory
-- and trigger coverage with the final snapshots.
--
-- Dumps contain this state, function and ALWAYS triggers. A freshly restored
-- clone stays fenced. Run final-freeze-release.sql in clone-restore mode on
-- that separately pinned cluster BEFORE Auth merge/migrations. Source rollback
-- uses source-rollback mode. Existing triggers/settings/ACLs are not replaced.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog;

DO $final_freeze$
DECLARE
  expected text := current_setting('tuat.final_freeze.expected_system_identifier', true);
  forbidden text := current_setting('tuat.final_freeze.forbidden_system_identifier', true);
  expected_inventory text := current_setting('tuat.final_freeze.expected_inventory_md5', true);
  generation text := current_setting('tuat.final_freeze.generation', true);
  target_kind text := current_setting('tuat.final_freeze.target_kind', true);
  actual text;
  inventory text;
  table_catalog jsonb;
  trigger_catalog jsonb;
  schema_created boolean;
  relation record;
BEGIN
  SELECT system_identifier::text INTO actual FROM pg_control_system();
  IF expected IS NULL OR expected !~ '^[0-9]{10,20}$' OR actual <> expected
    OR forbidden IS NULL OR forbidden !~ '^[0-9]{10,20}$' OR actual = forbidden
    OR expected = forbidden OR expected_inventory IS NULL
    OR expected_inventory !~ '^[a-f0-9]{32}$'
    OR generation IS NULL OR generation !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    OR target_kind IS NULL OR target_kind NOT IN ('old-primary','cloud-auth')
  THEN RAISE EXCEPTION 'Final source identity/settings mismatch'; END IF;
  IF to_regclass('pc_ops.final_freeze_state') IS NOT NULL
    OR to_regprocedure('pc_ops.guard_final_source_writes()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='pc_final_source_freeze')
  THEN RAISE EXCEPTION 'A final fence already exists; inspect before retry'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','storage','auth') AND c.relkind='f'
  ) OR EXISTS (
    SELECT required FROM unnest(ARRAY['public','storage','auth']) required
    WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=required)
  ) THEN RAISE EXCEPTION 'Unsupported final source schema'; END IF;

  FOR relation IN
    SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p')
    ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
  LOOP
    EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS EXCLUSIVE MODE',relation.nspname,relation.relname);
  END LOOP;
  SELECT md5(coalesce(string_agg(format('%I.%I:%s',n.nspname,c.relname,c.relkind),E'\n'
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),'')),
    jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind)
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C")
  INTO inventory,table_catalog
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  IF inventory <> expected_inventory OR table_catalog IS NULL
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(table_catalog) t WHERE t->>'schema'='auth')
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(table_catalog) t WHERE t->>'schema'='public')
  THEN RAISE EXCEPTION 'Final source table inventory changed'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
      'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",t.tgname COLLATE "C"),'[]'::jsonb)
  INTO trigger_catalog
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');

  schema_created := to_regnamespace('pc_ops') IS NULL;
  IF schema_created THEN CREATE SCHEMA pc_ops; END IF;
  CREATE TABLE pc_ops.final_freeze_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
    version integer NOT NULL CHECK(version=1),
    generation uuid NOT NULL,
    source_system_identifier text NOT NULL,
    source_database text NOT NULL,
    target_kind text NOT NULL,
    installed_at timestamptz NOT NULL,
    created_schema boolean NOT NULL,
    inventory_md5 text NOT NULL,
    table_catalog jsonb NOT NULL,
    previous_trigger_catalog jsonb NOT NULL,
    guard_source_md5 text NOT NULL
  );
  REVOKE ALL ON TABLE pc_ops.final_freeze_state FROM PUBLIC;
  EXECUTE $definition$
    CREATE FUNCTION pc_ops.guard_final_source_writes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
    BEGIN
      RAISE EXCEPTION 'Final source is frozen for server migration' USING ERRCODE='55000';
    END
    $guard$
  $definition$;
  REVOKE ALL ON FUNCTION pc_ops.guard_final_source_writes() FROM PUBLIC;
  FOR relation IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE pc_ops.final_freeze_state FROM %I',relation.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION pc_ops.guard_final_source_writes() FROM %I',relation.rolname);
    IF schema_created THEN EXECUTE format('REVOKE ALL ON SCHEMA pc_ops FROM %I',relation.rolname); END IF;
  END LOOP;
  IF schema_created THEN REVOKE ALL ON SCHEMA pc_ops FROM PUBLIC; END IF;
  INSERT INTO pc_ops.final_freeze_state
    SELECT true,1,generation::uuid,actual,current_database(),target_kind,clock_timestamp(),schema_created,
      inventory,table_catalog,trigger_catalog,md5(prosrc)
    FROM pg_proc WHERE oid='pc_ops.guard_final_source_writes()'::regprocedure;
  FOR relation IN SELECT value->>'schema' AS schema_name,value->>'table' AS table_name FROM jsonb_array_elements(table_catalog) LOOP
    EXECUTE format('CREATE TRIGGER pc_final_source_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.guard_final_source_writes()',relation.schema_name,relation.table_name);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER pc_final_source_freeze',relation.schema_name,relation.table_name);
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname='pc_final_source_freeze'
      AND tgfoid='pc_ops.guard_final_source_writes()'::regprocedure AND tgenabled='A' AND tgtype=62)
      <> jsonb_array_length(table_catalog)
  THEN RAISE EXCEPTION 'Final fence coverage mismatch'; END IF;
END
$final_freeze$;
COMMIT;

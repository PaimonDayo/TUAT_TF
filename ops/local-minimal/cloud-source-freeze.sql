-- Operator-only CLOUD source fence; never an application migration.
-- First run the entire file with final COMMIT replaced by ROLLBACK. Bind on
-- the SAME connection: tuat.cloud_final_freeze.expected_system_identifier,
-- forbidden_system_identifier (candidate SYS), expected_inventory_md5,
-- generation (new UUID), target_kind='cloud-auth'. Inventory MD5 uses every
-- r/p table in public/storage/auth, including the four explicit exclusions.
-- This is NOT an all-Auth freeze: auth.schema_migrations and storage.migrations
-- remain provider migration metadata; storage.buckets_vectors/vector_indexes
-- must be empty and unused. Those four have no guard and are recorded as such.
-- Owned tables use ALWAYS; nonowned tables with UPDATE+TRIGGER grants use O
-- (origin mode). Administrative replica-mode writes can bypass O triggers.
-- Root must stop old API/Auth entries and schema DDL, drain jobs/mirror, export
-- ALL 27 Auth tables in one REPEATABLE READ snapshot, and retire this old source.
-- There are no mirror/service-role/restore exceptions to guarded statements.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog;

DO $cloud_freeze$
DECLARE
  expected text:=current_setting('tuat.cloud_final_freeze.expected_system_identifier',true);
  forbidden text:=current_setting('tuat.cloud_final_freeze.forbidden_system_identifier',true);
  expected_inventory text:=current_setting('tuat.cloud_final_freeze.expected_inventory_md5',true);
  generation text:=current_setting('tuat.cloud_final_freeze.generation',true);
  target_kind text:=current_setting('tuat.cloud_final_freeze.target_kind',true);
  excluded constant text[]:=ARRAY['auth.schema_migrations','storage.buckets_vectors','storage.migrations','storage.vector_indexes'];
  actual text; inventory text; table_catalog jsonb; coverage jsonb; omitted jsonb:='[]';
  previous_triggers jsonb; previous_schemas jsonb; schema_created boolean; item record; row_count bigint;
BEGIN
  SELECT system_identifier::text INTO actual FROM pg_control_system();
  IF expected IS NULL OR expected!~'^[0-9]{10,20}$' OR actual<>expected
    OR forbidden IS NULL OR forbidden!~'^[0-9]{10,20}$' OR actual=forbidden OR expected=forbidden
    OR expected_inventory IS NULL OR expected_inventory!~'^[a-f0-9]{32}$'
    OR generation IS NULL OR generation!~'^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    OR target_kind IS DISTINCT FROM 'cloud-auth' OR current_setting('session_replication_role')<>'origin'
  THEN RAISE EXCEPTION 'Cloud source identity/settings mismatch'; END IF;
  IF to_regclass('pc_ops.cloud_final_freeze_state') IS NOT NULL
    OR to_regprocedure('pc_ops.guard_cloud_final_source_writes()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='pc_cloud_final_source_freeze')
  THEN RAISE EXCEPTION 'A cloud source fence already exists; inspect before retry'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','storage','auth') AND c.relkind='f')
    OR (SELECT count(*) FROM pg_namespace WHERE nspname IN ('public','storage','auth'))<>3
    OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname||'.'||c.relname=ANY(excluded) AND c.relkind='r')<>4
  THEN RAISE EXCEPTION 'Cloud source schemas or exact managed exclusions changed'; END IF;

  -- Access-share locks on managed exclusions need only SELECT and hold their
  -- definitions stable. They deliberately do not claim to stop managed writes.
  FOR item IN SELECT n.nspname,c.relname,c.oid,c.relowner,
      n.nspname||'.'||c.relname=ANY(excluded) AS omitted
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p')
    ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
  LOOP
    IF item.omitted THEN
      IF NOT has_table_privilege(current_user,item.oid,'SELECT') THEN RAISE EXCEPTION 'Managed table observation privilege missing'; END IF;
      EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS SHARE MODE',item.nspname,item.relname);
      EXECUTE format('SELECT count(*) FROM %I.%I',item.nspname,item.relname) INTO row_count;
      IF item.relname IN ('buckets_vectors','vector_indexes') AND row_count<>0
      THEN RAISE EXCEPTION 'Managed vector table is in use; cloud fence refused'; END IF;
      omitted:=omitted||jsonb_build_array(jsonb_build_object('schema',item.nspname,'table',item.relname,'rows',row_count,
        'guarded',false,'reason',CASE WHEN item.relname IN ('buckets_vectors','vector_indexes') THEN 'unused-managed-vector' ELSE 'provider-migration-metadata' END));
    ELSE
      IF NOT has_table_privilege(current_user,item.oid,'UPDATE') OR NOT has_table_privilege(current_user,item.oid,'TRIGGER')
      THEN RAISE EXCEPTION 'Cloud guarded table privilege missing'; END IF;
      EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS EXCLUSIVE MODE',item.nspname,item.relname);
    END IF;
  END LOOP;
  SELECT md5(coalesce(string_agg(format('%I.%I:%s',n.nspname,c.relname,c.relkind),E'\n'
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),'')),
    jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind,
      'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text) ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),
    jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind,
      'enabled',CASE WHEN c.relowner=current_user::regrole THEN 'A' ELSE 'O' END)
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C") FILTER(WHERE n.nspname||'.'||c.relname<>ALL(excluded))
  INTO inventory,table_catalog,coverage
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  IF inventory IS DISTINCT FROM expected_inventory OR table_catalog IS NULL OR coverage IS NULL
    OR jsonb_array_length(table_catalog)<>jsonb_array_length(coverage)+4
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) t WHERE t->>'schema'='auth')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) t WHERE t->>'schema'='public')
  THEN RAISE EXCEPTION 'Cloud source full table inventory changed'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
      'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",t.tgname COLLATE "C"),'[]')
    INTO previous_triggers FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  SELECT jsonb_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname COLLATE "C")
    INTO previous_schemas FROM pg_namespace WHERE nspname IN ('public','storage','auth','pc_ops');
  schema_created:=to_regnamespace('pc_ops') IS NULL;
  IF schema_created THEN CREATE SCHEMA pc_ops; END IF;
  CREATE TABLE pc_ops.cloud_final_freeze_state(
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL CHECK(version=1),
    generation uuid NOT NULL, source_system_identifier text NOT NULL, source_database text NOT NULL,
    target_kind text NOT NULL CHECK(target_kind='cloud-auth'), installed_by text NOT NULL, installed_at timestamptz NOT NULL,
    created_schema boolean NOT NULL, inventory_md5 text NOT NULL, full_table_catalog jsonb NOT NULL,
    guarded_table_catalog jsonb NOT NULL, excluded_table_catalog jsonb NOT NULL,
    previous_trigger_catalog jsonb NOT NULL, previous_schema_catalog jsonb NOT NULL, guard_definition_md5 text NOT NULL
  );
  REVOKE ALL ON TABLE pc_ops.cloud_final_freeze_state FROM PUBLIC;
  EXECUTE $definition$
    CREATE FUNCTION pc_ops.guard_cloud_final_source_writes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path=pg_catalog AS $guard$
    BEGIN RAISE EXCEPTION 'Cloud old source guarded table is frozen for migration' USING ERRCODE='55000'; END
    $guard$
  $definition$;
  REVOKE ALL ON FUNCTION pc_ops.guard_cloud_final_source_writes() FROM PUBLIC;
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON TABLE pc_ops.cloud_final_freeze_state FROM %I',item.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION pc_ops.guard_cloud_final_source_writes() FROM %I',item.rolname);
    IF schema_created THEN EXECUTE format('REVOKE ALL ON SCHEMA pc_ops FROM %I',item.rolname); END IF;
  END LOOP;
  IF schema_created THEN REVOKE ALL ON SCHEMA pc_ops FROM PUBLIC; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(coverage) LOOP
    EXECUTE format('CREATE TRIGGER pc_cloud_final_source_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.guard_cloud_final_source_writes()',item.value->>'schema',item.value->>'table');
    IF item.value->>'enabled'='A' THEN EXECUTE format('ALTER TABLE %I.%I ENABLE ALWAYS TRIGGER pc_cloud_final_source_freeze',item.value->>'schema',item.value->>'table'); END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname='pc_cloud_final_source_freeze')<>jsonb_array_length(coverage)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) AS guarded_entry(value) WHERE NOT EXISTS(
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('%I.%I',guarded_entry.value->>'schema',guarded_entry.value->>'table'))
        AND t.tgname='pc_cloud_final_source_freeze' AND NOT t.tgisinternal AND t.tgtype=62 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND t.tgenabled::text=guarded_entry.value->>'enabled' AND t.tgfoid='pc_ops.guard_cloud_final_source_writes()'::regprocedure))
  THEN RAISE EXCEPTION 'Cloud source exact A/O trigger coverage mismatch'; END IF;
  INSERT INTO pc_ops.cloud_final_freeze_state SELECT true,1,generation::uuid,actual,current_database(),target_kind,current_user,
    clock_timestamp(),schema_created,inventory,table_catalog,coverage,omitted,previous_triggers,previous_schemas,
    md5(pg_get_functiondef('pc_ops.guard_cloud_final_source_writes()'::regprocedure));
END
$cloud_freeze$;
COMMIT;

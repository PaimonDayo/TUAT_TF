-- Exact removal of cloud-source-freeze.sql additions, never a migration.
-- SAME-connection GUCs under tuat.cloud_final_freeze:
-- expected_system_identifier = actual target SYS;
-- expected_source_system_identifier = original cloud source SYS;
-- generation = installed UUID; release_mode = source-rollback | clone-restore.
-- Source rollback also pins the original database. Clone release requires a
-- separately explicit DIFFERENT physical SYS. No data is copied and no old
-- entry, Auth service, job or mirror is resumed by this file.
-- Full table/ACL/trigger coverage is checked; an Auth-only subset cannot pose
-- as a full cloud clone. Only the four recorded managed tables are excluded.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog;

DO $cloud_release$
DECLARE
  expected text:=current_setting('tuat.cloud_final_freeze.expected_system_identifier',true);
  expected_source text:=current_setting('tuat.cloud_final_freeze.expected_source_system_identifier',true);
  generation text:=current_setting('tuat.cloud_final_freeze.generation',true);
  release_mode text:=current_setting('tuat.cloud_final_freeze.release_mode',true);
  actual text; inventory text; current_tables jsonb; current_triggers jsonb; current_schemas jsonb;
  state pc_ops.cloud_final_freeze_state%ROWTYPE; item record; row_count bigint; guard_oid oid;
BEGIN
  SELECT system_identifier::text INTO actual FROM pg_control_system();
  IF expected IS NULL OR expected!~'^[0-9]{10,20}$' OR actual<>expected
    OR expected_source IS NULL OR expected_source!~'^[0-9]{10,20}$'
    OR generation IS NULL OR generation!~'^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    OR release_mode IS NULL OR release_mode NOT IN ('source-rollback','clone-restore')
  THEN RAISE EXCEPTION 'Cloud release identity/settings mismatch'; END IF;
  LOCK TABLE pc_ops.cloud_final_freeze_state IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO STRICT state FROM pc_ops.cloud_final_freeze_state WHERE singleton;
  guard_oid:=to_regprocedure('pc_ops.guard_cloud_final_source_writes()');
  IF state.version<>1 OR state.target_kind<>'cloud-auth' OR state.generation<>generation::uuid
    OR state.source_system_identifier<>expected_source OR guard_oid IS NULL
    OR (release_mode='source-rollback' AND (actual<>state.source_system_identifier OR current_database()<>state.source_database))
    OR (release_mode='clone-restore' AND actual=state.source_system_identifier)
    OR state.guard_definition_md5 IS DISTINCT FROM md5(pg_get_functiondef(guard_oid))
    OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=guard_oid) IS DISTINCT FROM state.installed_by
    OR jsonb_array_length(state.full_table_catalog)<>jsonb_array_length(state.guarded_table_catalog)+4
    OR jsonb_array_length(state.excluded_table_catalog)<>4
  THEN RAISE EXCEPTION 'Cloud release does not match installed full fence'; END IF;
  IF (SELECT array_agg(format('%s.%s',value->>'schema',value->>'table') ORDER BY value->>'schema',value->>'table')
      FROM jsonb_array_elements(state.excluded_table_catalog)) IS DISTINCT FROM
      ARRAY['auth.schema_migrations','storage.buckets_vectors','storage.migrations','storage.vector_indexes']::text[]
  THEN RAISE EXCEPTION 'Cloud release managed exclusion scope changed'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(state.full_table_catalog) LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(state.excluded_table_catalog) omitted
      WHERE omitted->>'schema'=item.value->>'schema' AND omitted->>'table'=item.value->>'table')
    THEN EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS SHARE MODE',item.value->>'schema',item.value->>'table');
    ELSE EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS EXCLUSIVE MODE',item.value->>'schema',item.value->>'table'); END IF;
  END LOOP;
  SELECT md5(coalesce(string_agg(format('%I.%I:%s',n.nspname,c.relname,c.relkind),E'\n'
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),'')),
    jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind,
      'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text) ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C")
  INTO inventory,current_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  IF inventory IS DISTINCT FROM state.inventory_md5 OR current_tables IS DISTINCT FROM state.full_table_catalog
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','storage','auth') AND c.relkind='f')
    OR (SELECT count(*) FROM pg_trigger WHERE tgname='pc_cloud_final_source_freeze')<>jsonb_array_length(state.guarded_table_catalog)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(state.guarded_table_catalog) AS guarded_entry(value) WHERE NOT EXISTS(
      SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('%I.%I',guarded_entry.value->>'schema',guarded_entry.value->>'table'))
        AND t.tgname='pc_cloud_final_source_freeze' AND NOT t.tgisinternal AND t.tgtype=62 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND t.tgenabled::text=guarded_entry.value->>'enabled' AND t.tgfoid=guard_oid))
  THEN RAISE EXCEPTION 'Cloud release full table/ACL/A-O guard coverage changed'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(state.excluded_table_catalog) LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I',item.value->>'schema',item.value->>'table') INTO row_count;
    IF row_count IS DISTINCT FROM (item.value->>'rows')::bigint
    THEN RAISE EXCEPTION 'Cloud managed metadata/vector observations changed'; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
      'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",t.tgname COLLATE "C"),'[]')
  INTO current_triggers FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND t.tgname<>'pc_cloud_final_source_freeze'
    AND n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  SELECT jsonb_agg(jsonb_build_object('schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname COLLATE "C")
    INTO current_schemas FROM pg_namespace WHERE nspname IN ('public','storage','auth','pc_ops') AND NOT(state.created_schema AND nspname='pc_ops');
  IF current_triggers IS DISTINCT FROM state.previous_trigger_catalog OR current_schemas IS DISTINCT FROM state.previous_schema_catalog
  THEN RAISE EXCEPTION 'Original cloud triggers or schema ACLs changed; review recovery'; END IF;

  -- A TRIGGER grantee can create a normal trigger but cannot DROP TRIGGER on
  -- somebody else's table. The installer owns only this dedicated function;
  -- CASCADE may remove exactly its already-verified fence dependencies.
  IF EXISTS(SELECT 1 FROM pg_depend d WHERE d.refclassid='pg_proc'::regclass AND d.refobjid=guard_oid AND
      (d.classid<>'pg_trigger'::regclass OR d.deptype<>'n' OR NOT EXISTS(
        SELECT 1 FROM pg_trigger t JOIN jsonb_array_elements(state.guarded_table_catalog) AS expected_guard(value)
          ON t.tgrelid=to_regclass(format('%I.%I',expected_guard.value->>'schema',expected_guard.value->>'table'))
        WHERE t.oid=d.objid AND t.tgname='pc_cloud_final_source_freeze' AND t.tgfoid=guard_oid)))
  THEN RAISE EXCEPTION 'Cloud guard has an unexpected dependent object'; END IF;
  DROP FUNCTION pc_ops.guard_cloud_final_source_writes() CASCADE;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='pc_cloud_final_source_freeze')
  THEN RAISE EXCEPTION 'Cloud fence removal was incomplete'; END IF;
  DROP TABLE pc_ops.cloud_final_freeze_state;
  IF state.created_schema THEN DROP SCHEMA pc_ops; END IF;
END
$cloud_release$;
COMMIT;

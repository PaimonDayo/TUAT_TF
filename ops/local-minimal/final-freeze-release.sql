-- Operator-only exact removal of final-freeze.sql's additions.
-- Preserve source snapshots and the final-freeze state before executing.
-- SAME-connection session settings required:
--   tuat.final_freeze.expected_system_identifier (the actual release target)
--   tuat.final_freeze.generation                 (the installed fence UUID)
--   tuat.final_freeze.release_mode               (source-rollback | clone-restore)
-- source-rollback requires the original cluster + database. clone-restore
-- requires a DIFFERENT physical cluster; it cannot unfreeze the source.
-- Neither mode copies data back or resumes Jobs/mirror/entries. Root must first
-- reconcile any writes accepted by the candidate before source rollback.
-- Existing non-fence triggers must still match the captured original catalog.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog;

DO $final_release$
DECLARE
  expected text := current_setting('tuat.final_freeze.expected_system_identifier', true);
  generation text := current_setting('tuat.final_freeze.generation', true);
  release_mode text := current_setting('tuat.final_freeze.release_mode', true);
  actual text;
  inventory text;
  previous_triggers jsonb;
  state pc_ops.final_freeze_state%ROWTYPE;
  relation record;
BEGIN
  SELECT system_identifier::text INTO actual FROM pg_control_system();
  IF expected IS NULL OR expected !~ '^[0-9]{10,20}$' OR actual <> expected
    OR generation IS NULL OR generation !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    OR release_mode IS NULL OR release_mode NOT IN ('source-rollback','clone-restore')
  THEN RAISE EXCEPTION 'Final release identity/settings mismatch'; END IF;
  LOCK TABLE pc_ops.final_freeze_state IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO STRICT state FROM pc_ops.final_freeze_state WHERE singleton;
  IF state.version<>1 OR state.generation<>generation::uuid
    OR (release_mode='source-rollback' AND (actual<>state.source_system_identifier OR current_database()<>state.source_database))
    OR (release_mode='clone-restore' AND actual=state.source_system_identifier)
    OR state.guard_source_md5 IS DISTINCT FROM (
      SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('pc_ops.guard_final_source_writes()'))
  THEN RAISE EXCEPTION 'Final release does not match installed fence'; END IF;

  FOR relation IN SELECT value->>'schema' AS schema_name,value->>'table' AS table_name FROM jsonb_array_elements(state.table_catalog) LOOP
    EXECUTE format('LOCK TABLE ONLY %I.%I IN ACCESS EXCLUSIVE MODE',relation.schema_name,relation.table_name);
  END LOOP;
  SELECT md5(coalesce(string_agg(format('%I.%I:%s',n.nspname,c.relname,c.relkind),E'\n'
    ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"),'')) INTO inventory
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  IF inventory<>state.inventory_md5 OR (SELECT count(*) FROM pg_trigger WHERE tgname='pc_final_source_freeze')<>jsonb_array_length(state.table_catalog)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(state.table_catalog) item
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid=to_regclass(format('%I.%I',item->>'schema',item->>'table'))
          AND t.tgname='pc_final_source_freeze' AND NOT t.tgisinternal AND t.tgtype=62
          AND t.tgenabled='A' AND t.tgfoid='pc_ops.guard_final_source_writes()'::regprocedure
      )
    ) THEN RAISE EXCEPTION 'Final release table/trigger inventory changed'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
      'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
      ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",t.tgname COLLATE "C"),'[]'::jsonb)
  INTO previous_triggers
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND t.tgname<>'pc_final_source_freeze'
    AND n.nspname IN ('public','storage','auth') AND c.relkind IN ('r','p');
  IF previous_triggers IS DISTINCT FROM state.previous_trigger_catalog
  THEN RAISE EXCEPTION 'Original trigger catalog changed; review recovery'; END IF;

  FOR relation IN SELECT value->>'schema' AS schema_name,value->>'table' AS table_name FROM jsonb_array_elements(state.table_catalog) LOOP
    EXECUTE format('DROP TRIGGER pc_final_source_freeze ON %I.%I',relation.schema_name,relation.table_name);
  END LOOP;
  DROP FUNCTION pc_ops.guard_final_source_writes();
  DROP TABLE pc_ops.final_freeze_state;
  IF state.created_schema THEN DROP SCHEMA pc_ops; END IF;
END
$final_release$;
COMMIT;

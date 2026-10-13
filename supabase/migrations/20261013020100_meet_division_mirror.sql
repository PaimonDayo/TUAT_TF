-- A complete mirror snapshot can reuse another appearance's old division,
-- ordinal, or imported key. Check these two unique constraints after the whole
-- replay; normal registrations continue to check them immediately.
DO $$
DECLARE spec record; existing record; constraint_count integer;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
  (ARRAY['competition_id','event_name','operation_key']::text[],'competition_appearance_event_operation_key'),
  (ARRAY['participant_id','event_name','ordinal']::text[],'competition_appearance_participant_event_ordinal')
 ) expected(columns,name) LOOP
  SELECT count(*) INTO constraint_count FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.competition_appearances'::regclass AND c.contype='u'
   AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.position)=spec.columns;
  IF constraint_count<>1 THEN RAISE EXCEPTION 'meet_appearance_unique_definition_changed'; END IF;
  SELECT c.conname,c.condeferrable,c.condeferred INTO existing FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.competition_appearances'::regclass AND c.contype='u'
   AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.position)=spec.columns;
  IF existing.condeferrable AND NOT existing.condeferred THEN
   IF existing.conname<>spec.name THEN
    EXECUTE format('ALTER TABLE public.competition_appearances RENAME CONSTRAINT %I TO %I',existing.conname,spec.name);
   END IF;
  ELSE
   EXECUTE format('ALTER TABLE public.competition_appearances DROP CONSTRAINT %I',existing.conname);
   EXECUTE format('ALTER TABLE public.competition_appearances ADD CONSTRAINT %I UNIQUE(%s) DEFERRABLE INITIALLY IMMEDIATE',
    spec.name,(SELECT string_agg(format('%I',name),',') FROM unnest(spec.columns) name));
  END IF;
 END LOOP;
END $$;

-- The import's appearance INSERT must select the unchanged, immediate ID PK
-- as its arbiter. Preserve its existing body and every other table's behavior.
DO $$
DECLARE
 definition text; old_clause text:='FROM dedup s JOIN public.competition_participants p ON p.id=s.participant_id JOIN public.competition_meet_events e ON e.competition_id=s.competition_id AND e.name=s.event_name ON CONFLICT DO NOTHING;';
 new_clause text:='FROM dedup s JOIN public.competition_participants p ON p.id=s.participant_id JOIN public.competition_meet_events e ON e.competition_id=s.competition_id AND e.name=s.event_name ON CONFLICT(id) DO NOTHING;';
BEGIN
 IF to_regprocedure('public.refresh_competition_meet_import(boolean,text)') IS NULL
 THEN RAISE EXCEPTION 'meet_import_definition_changed'; END IF;
 definition:=pg_get_functiondef('public.refresh_competition_meet_import(boolean,text)'::regprocedure);
 IF strpos(definition,old_clause)>0 THEN
  IF length(definition)-length(replace(definition,old_clause,''))<>length(old_clause)
  THEN RAISE EXCEPTION 'meet_import_definition_changed'; END IF;
  EXECUTE replace(definition,old_clause,new_clause);
 ELSIF strpos(definition,new_clause)=0
  OR length(definition)-length(replace(definition,new_clause,''))<>length(new_clause)
 THEN RAISE EXCEPTION 'meet_import_definition_changed'; END IF;
END $$;

DO $$ BEGIN
 IF to_regprocedure('public.replay_competition_meet_changes_base(jsonb)') IS NULL THEN
  ALTER FUNCTION public.replay_competition_meet_changes(jsonb) RENAME TO replay_competition_meet_changes_base;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.replay_competition_meet_changes_base(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.replay_competition_meet_changes(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 SET CONSTRAINTS public.competition_appearance_event_operation_key,
  public.competition_appearance_participant_event_ordinal DEFERRED;
 result:=public.replay_competition_meet_changes_base(p_rows);
 -- Raise any final duplicate inside this RPC, before its result is accepted.
 SET CONSTRAINTS public.competition_appearance_event_operation_key,
  public.competition_appearance_participant_event_ordinal IMMEDIATE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.replay_competition_meet_changes(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.replay_competition_meet_changes(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

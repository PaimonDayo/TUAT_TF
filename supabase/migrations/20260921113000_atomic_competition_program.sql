-- Keep the last successful program visible until the whole replacement succeeds.
CREATE OR REPLACE FUNCTION public.replace_competition_program(target_competition_id TEXT, program_rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted INTEGER;
BEGIN
  IF jsonb_typeof(program_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected program array'; END IF;
  IF jsonb_array_length(program_rows) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid program size'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('competition-program:' || target_competition_id, 0));
  IF NOT EXISTS (SELECT 1 FROM public.competitions WHERE id=target_competition_id) THEN RAISE EXCEPTION 'Unknown competition'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(program_rows) row WHERE
      row->>'event_date' IS NULL OR row->>'block' NOT IN ('track','field') OR row->>'block' IS NULL
      OR NULLIF(row->>'round_key','') IS NULL OR NULLIF(row->>'event_label','') IS NULL
      OR jsonb_typeof(row->'tuat_entries') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'Invalid program row'; END IF;
  DELETE FROM public.competition_program_entries WHERE competition_id=target_competition_id;
  INSERT INTO public.competition_program_entries(competition_id,event_date,block,sort_order,time_label,round_key,event_label,status,tuat_entries)
  SELECT target_competition_id,r.event_date,r.block,r.sort_order,r.time_label,r.round_key,r.event_label,r.status,r.tuat_entries
  FROM jsonb_to_recordset(program_rows) AS r(event_date DATE,block TEXT,sort_order INTEGER,time_label TEXT,round_key TEXT,event_label TEXT,status TEXT,tuat_entries JSONB);
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_competition_program(TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_competition_program(TEXT,JSONB) TO service_role;
NOTIFY pgrst,'reload schema';

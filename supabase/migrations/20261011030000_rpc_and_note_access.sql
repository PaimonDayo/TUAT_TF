-- Keep authenticated note/social access and existing service execution privileges.
-- Deny anonymous SECURITY DEFINER RPCs and reserve sync cursors for service jobs.
-- No approval gate, table data, trigger, notification, or mirror configuration changes.

CREATE OR REPLACE FUNCTION public.claim_sheet_sync_chunk(
  requested_chunk_size INTEGER DEFAULT 100,
  reset_cycle BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_chunk_size INTEGER := LEAST(100, GREATEST(1, requested_chunk_size));
  current_offset INTEGER;
  member_total INTEGER;
  selected_names TEXT[];
  claimed_count INTEGER;
  raw_next_offset INTEGER;
  completed BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('practice-record-sheet-sync-chunk'));

  INSERT INTO public.sheet_sync_state (sync_key, next_offset)
  VALUES ('practice_records', 0)
  ON CONFLICT (sync_key) DO NOTHING;

  SELECT COUNT(*)::INTEGER INTO member_total
  FROM public.profiles
  WHERE sheet_name IS NOT NULL AND btrim(sheet_name) <> '';

  SELECT CASE
    WHEN reset_cycle OR next_offset >= member_total THEN 0
    ELSE next_offset
  END
  INTO current_offset
  FROM public.sheet_sync_state
  WHERE sync_key = 'practice_records'
  FOR UPDATE;

  SELECT COALESCE(array_agg(sheet_name ORDER BY sheet_name, id), ARRAY[]::TEXT[])
  INTO selected_names
  FROM (
    SELECT id, btrim(sheet_name) AS sheet_name
    FROM public.profiles
    WHERE sheet_name IS NOT NULL AND btrim(sheet_name) <> ''
    ORDER BY btrim(sheet_name), id
    OFFSET current_offset
    LIMIT safe_chunk_size
  ) selected;

  claimed_count := COALESCE(array_length(selected_names, 1), 0);
  raw_next_offset := current_offset + claimed_count;
  completed := member_total = 0 OR raw_next_offset >= member_total;

  UPDATE public.sheet_sync_state
  SET
    next_offset = CASE WHEN completed THEN 0 ELSE raw_next_offset END,
    cycle_started_at = CASE WHEN current_offset = 0 THEN NOW() ELSE cycle_started_at END,
    cycle_completed_at = CASE WHEN completed THEN NOW() ELSE cycle_completed_at END,
    updated_at = NOW()
  WHERE sync_key = 'practice_records';

  RETURN jsonb_build_object(
    'sheetNames', to_jsonb(selected_names),
    'startOffset', current_offset,
    'endOffset', raw_next_offset,
    'totalMembers', member_total,
    'cycleComplete', completed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_sheet_sync_cursor()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sheet_sync_state (sync_key, next_offset)
  VALUES ('practice_records', 0)
  ON CONFLICT (sync_key) DO UPDATE
    SET next_offset = 0, cycle_started_at = NULL, updated_at = NOW();
END;
$$;

-- Approved remains an automatic registration default. Preserve current access
-- for authors, designated editors, published notes, and existing managers.
CREATE OR REPLACE FUNCTION public.can_view_note(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (auth.uid() IS NOT NULL OR COALESCE(auth.role(), '') = 'service_role')
    AND EXISTS (
      SELECT 1
      FROM public.notes note
      WHERE note.id = target_note_id
        AND (
          note.status = 'published'
          OR note.author_id = auth.uid()
          OR public.is_admin()
          OR public.can_manage_system()
          OR public.can_edit_note(note.id)
        )
    );
$$;

DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    status = 'published'
    OR author_id = auth.uid()
    OR public.is_admin()
    OR public.can_manage_system()
    OR public.can_edit_note(id)
  )
);
REVOKE SELECT ON public.notes FROM anon;

-- Reuse the reviewed 2026-10-09 ACL correction at a new migration timestamp.
-- REVOKE FROM PUBLIC alone leaves Supabase's explicit anon EXECUTE grants.
-- Preserve effective authenticated/service grants before removing PUBLIC.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
    IF has_function_privilege('service_role', fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sheet_sync_chunk(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sheet_sync_chunk(INTEGER, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.reset_sheet_sync_cursor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_sheet_sync_cursor() TO service_role;

NOTIFY pgrst, 'reload schema';

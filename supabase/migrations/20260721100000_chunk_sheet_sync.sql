-- Store application-side progress only. This does not change Google Sheet sharing,
-- permissions, ownership, OAuth scopes, or the deployed GAS configuration.
CREATE TABLE IF NOT EXISTS public.sheet_sync_state (
  sync_key TEXT PRIMARY KEY,
  next_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
  cycle_started_at TIMESTAMPTZ,
  cycle_completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sheet_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sheet_sync_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sheet_sync_state TO service_role;

INSERT INTO public.sheet_sync_state (sync_key, next_offset)
VALUES ('practice_records', 0)
ON CONFLICT (sync_key) DO NOTHING;

ALTER TABLE public.sheet_sync_runs
  ADD COLUMN IF NOT EXISTS chunk_start INTEGER,
  ADD COLUMN IF NOT EXISTS chunk_end INTEGER,
  ADD COLUMN IF NOT EXISTS total_members INTEGER,
  ADD COLUMN IF NOT EXISTS cycle_complete BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.claim_sheet_sync_chunk(
  requested_chunk_size INTEGER DEFAULT 16,
  reset_cycle BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_chunk_size INTEGER := LEAST(30, GREATEST(1, requested_chunk_size));
  current_offset INTEGER;
  member_total INTEGER;
  selected_names TEXT[];
  claimed_count INTEGER;
  raw_next_offset INTEGER;
  completed BOOLEAN;
BEGIN
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

REVOKE ALL ON FUNCTION public.claim_sheet_sync_chunk(INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_sheet_sync_chunk(INTEGER, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_sheet_sync_cursor()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.sheet_sync_state (sync_key, next_offset)
  VALUES ('practice_records', 0)
  ON CONFLICT (sync_key) DO UPDATE
    SET next_offset = 0, cycle_started_at = NULL, updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.reset_sheet_sync_cursor() FROM PUBLIC;

-- The former three-consecutive-failures alert was misleading for chunked runs.
DROP FUNCTION IF EXISTS public.notify_sync_failure_if_needed(UUID);

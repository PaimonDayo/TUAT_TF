-- PC-only writeCells evidence, not an offline queue. No payload/credential is stored.
-- Excluded from zz_log_failover_change / mirror TABLES: a fallback replay or mirror
-- overwrite must never grant a second external dispatch. public encrypted backup
-- preserves these receipts. No expiry, takeover, cascade or automatic deletion.
CREATE TABLE IF NOT EXISTS public.sheet_push_attempts (
  attempt_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('record', 'clear')),
  profile_id uuid NOT NULL,
  recorded_date date NOT NULL,
  record_id uuid,
  expected_version timestamptz NOT NULL,
  expected_profile jsonb NOT NULL CHECK (jsonb_typeof(expected_profile) = 'object'),
  profile_fingerprint text NOT NULL CHECK (profile_fingerprint ~ '^[0-9a-f]{64}$'),
  target_slot text NOT NULL CHECK (target_slot ~ '^[0-9a-f]{64}$'),
  target_fingerprint text NOT NULL CHECK (target_fingerprint ~ '^[0-9a-f]{64}$'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'confirmed', 'completed')),
  provider_complete boolean NOT NULL DEFAULT false,
  marker_status text NOT NULL DEFAULT 'pending' CHECK (marker_status IN ('pending', 'applied', 'superseded', 'partial')),
  marker_version timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  CHECK ((kind = 'record' AND record_id IS NOT NULL) OR (kind = 'clear' AND record_id IS NULL)),
  CHECK ((state = 'reserved' AND NOT provider_complete AND marker_status = 'pending' AND confirmed_at IS NULL AND completed_at IS NULL)
    OR (state = 'confirmed' AND NOT provider_complete AND marker_status = 'partial' AND confirmed_at IS NOT NULL AND completed_at IS NULL)
    OR (state = 'completed' AND provider_complete AND marker_status IN ('applied', 'superseded') AND confirmed_at IS NOT NULL AND completed_at IS NOT NULL))
);
COMMENT ON TABLE public.sheet_push_attempts IS
  'PC external writeCells receipt. Unknown/partial results hold record/date/target across restart/edit/deletion; service RPCs only; no expiry or failover replay.';
ALTER TABLE public.sheet_push_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sheet_push_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sheet_push_attempts TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS sheet_push_active_record ON public.sheet_push_attempts(record_id)
  WHERE state <> 'completed' AND record_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sheet_push_active_date ON public.sheet_push_attempts(profile_id, recorded_date)
  WHERE state <> 'completed';
CREATE UNIQUE INDEX IF NOT EXISTS sheet_push_active_slot ON public.sheet_push_attempts(target_slot)
  WHERE state <> 'completed';
CREATE INDEX IF NOT EXISTS sheet_push_completed_record ON public.sheet_push_attempts(record_id, expected_version)
  WHERE state = 'completed';

CREATE OR REPLACE FUNCTION public.sheet_push_begin(
  p_attempt_id uuid, p_kind text, p_record_id uuid, p_profile_id uuid,
  p_recorded_date date, p_expected_version timestamptz, p_expected_profile jsonb,
  p_target_slot text, p_target_fingerprint text, p_payload_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rec public.practice_records%ROWTYPE;
  queued public.sheet_pending_clears%ROWTYPE;
  member public.profiles%ROWTYPE;
  prior public.sheet_push_attempts%ROWTYPE;
  current_profile jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_attempt_id IS NULL OR p_profile_id IS NULL OR p_recorded_date IS NULL OR p_expected_version IS NULL
    OR p_kind IS NULL OR p_kind NOT IN ('record', 'clear')
    OR (p_kind = 'record' AND p_record_id IS NULL) OR (p_kind = 'clear' AND p_record_id IS NOT NULL)
    OR p_target_slot IS NULL OR p_target_slot !~ '^[0-9a-f]{64}$'
    OR p_target_fingerprint IS NULL OR p_target_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid sheet attempt binding';
  END IF;
  -- Existing record/queue first, profile second: same order as record triggers.
  IF p_kind = 'record' THEN
    SELECT * INTO rec FROM public.practice_records WHERE id = p_record_id FOR UPDATE;
    IF NOT FOUND OR rec.user_id IS DISTINCT FROM p_profile_id OR rec.recorded_date IS DISTINCT FROM p_recorded_date
      OR rec.updated_at IS DISTINCT FROM p_expected_version THEN
      RETURN jsonb_build_object('outcome', 'stale', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
    END IF;
  ELSE
    SELECT * INTO queued FROM public.sheet_pending_clears
      WHERE user_id = p_profile_id AND recorded_date = p_recorded_date FOR UPDATE;
    IF NOT FOUND OR queued.created_at IS DISTINCT FROM p_expected_version THEN
      RETURN jsonb_build_object('outcome', 'stale', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
    END IF;
  END IF;
  -- Serialize the physical slot with no-provider clear resolution, including
  -- another profile pointing to the same normalized tab/date.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_target_slot, 6101117));
  -- Exclusive profile lock serializes the CSV-import guard even when there is no
  -- record yet. App edits remain allowed after this short reservation transaction.
  SELECT * INTO member FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND OR NOT member.approved OR member.status <> 'active'
    OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_profile_id AND public.login_email_is_allowed(u.email)) THEN
    RETURN jsonb_build_object('outcome', 'stale', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
  END IF;
  current_profile := jsonb_build_object('sheet_name', member.sheet_name, 'record_fields', member.record_fields,
    'sheet_transition', member.sheet_transition, 'sheet_header_signature', member.sheet_header_signature, 'record_source', member.record_source);
  IF current_profile IS DISTINCT FROM p_expected_profile
    OR (p_kind = 'clear' AND EXISTS (SELECT 1 FROM public.practice_records WHERE user_id = p_profile_id AND recorded_date = p_recorded_date)) THEN
    RETURN jsonb_build_object('outcome', 'stale', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
  END IF;
  SELECT * INTO prior FROM public.sheet_push_attempts WHERE attempt_id = p_attempt_id FOR UPDATE;
  IF FOUND THEN
    -- A repeated reservation response never authorizes another POST, even with
    -- the same attempt id. A lost first response is dispatch0 for that pass.
    IF prior.kind IS DISTINCT FROM p_kind OR prior.record_id IS DISTINCT FROM p_record_id
      OR prior.profile_id IS DISTINCT FROM p_profile_id OR prior.recorded_date IS DISTINCT FROM p_recorded_date
      OR prior.expected_version IS DISTINCT FROM p_expected_version OR prior.expected_profile IS DISTINCT FROM p_expected_profile
      OR prior.target_slot IS DISTINCT FROM p_target_slot OR prior.target_fingerprint IS DISTINCT FROM p_target_fingerprint
      OR prior.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
      RETURN jsonb_build_object('outcome', 'blocked', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
    END IF;
    RETURN jsonb_build_object('outcome', CASE WHEN prior.state = 'reserved' THEN 'blocked' ELSE prior.state END,
      'attempt_id', prior.attempt_id, 'marker_status', prior.marker_status);
  END IF;
  SELECT * INTO prior FROM public.sheet_push_attempts WHERE state <> 'completed'
    AND (record_id = p_record_id OR (profile_id = p_profile_id AND recorded_date = p_recorded_date) OR target_slot = p_target_slot)
    LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'blocked', 'attempt_id', prior.attempt_id, 'marker_status', prior.marker_status);
  END IF;
  SELECT * INTO prior FROM public.sheet_push_attempts WHERE state = 'completed'
    AND kind = p_kind AND record_id IS NOT DISTINCT FROM p_record_id AND profile_id = p_profile_id AND recorded_date = p_recorded_date
    AND (expected_version = p_expected_version OR (marker_status = 'applied' AND marker_version = p_expected_version))
    AND expected_profile = p_expected_profile AND target_slot = p_target_slot
    AND target_fingerprint = p_target_fingerprint AND payload_sha256 = p_payload_sha256
    ORDER BY completed_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'completed', 'attempt_id', prior.attempt_id, 'marker_status', prior.marker_status);
  END IF;
  BEGIN
    INSERT INTO public.sheet_push_attempts(attempt_id, kind, profile_id, recorded_date, record_id, expected_version, expected_profile,
      profile_fingerprint, target_slot, target_fingerprint, payload_sha256)
    VALUES (p_attempt_id, p_kind, p_profile_id, p_recorded_date, p_record_id, p_expected_version, current_profile,
      encode(sha256(convert_to(current_profile::text, 'UTF8')), 'hex'), p_target_slot, p_target_fingerprint, p_payload_sha256);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'blocked', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
  END;
  RETURN jsonb_build_object('outcome', 'send', 'attempt_id', p_attempt_id, 'marker_status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.sheet_push_finish(
  p_attempt_id uuid, p_target_fingerprint text, p_payload_sha256 text, p_provider_complete boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  attempt public.sheet_push_attempts%ROWTYPE;
  initial public.sheet_push_attempts%ROWTYPE;
  rec public.practice_records%ROWTYPE;
  queued public.sheet_pending_clears%ROWTYPE;
  member public.profiles%ROWTYPE;
  current_profile jsonb;
  matched boolean := false;
  resulting_version timestamptz;
  marker text := 'superseded';
  changed integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required';
  END IF;
  IF p_provider_complete IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Provider result required'; END IF;
  SELECT * INTO initial FROM public.sheet_push_attempts WHERE attempt_id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Sheet attempt not found'; END IF;
  IF initial.kind = 'record' THEN
    SELECT * INTO rec FROM public.practice_records WHERE id = initial.record_id FOR UPDATE;
    matched := FOUND AND rec.user_id = initial.profile_id AND rec.recorded_date = initial.recorded_date AND rec.updated_at = initial.expected_version;
  ELSE
    SELECT * INTO queued FROM public.sheet_pending_clears
      WHERE user_id = initial.profile_id AND recorded_date = initial.recorded_date FOR UPDATE;
    matched := FOUND AND queued.created_at = initial.expected_version;
  END IF;
  SELECT * INTO member FROM public.profiles WHERE id = initial.profile_id FOR UPDATE;
  IF FOUND THEN
    current_profile := jsonb_build_object('sheet_name', member.sheet_name, 'record_fields', member.record_fields,
      'sheet_transition', member.sheet_transition, 'sheet_header_signature', member.sheet_header_signature, 'record_source', member.record_source);
  END IF;
  matched := coalesce(matched AND current_profile = initial.expected_profile AND member.approved AND member.status = 'active', false);
  SELECT * INTO attempt FROM public.sheet_push_attempts WHERE attempt_id = p_attempt_id FOR UPDATE;
  IF attempt.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR attempt.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Sheet result binding mismatch';
  END IF;
  IF attempt.state <> 'reserved' THEN
    RETURN jsonb_build_object('outcome', attempt.state, 'marker_status', attempt.marker_status);
  END IF;
  IF NOT p_provider_complete THEN
    UPDATE public.sheet_push_attempts SET state = 'confirmed', marker_status = 'partial', confirmed_at = clock_timestamp()
      WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object('outcome', 'confirmed', 'marker_status', 'partial');
  END IF;
  IF attempt.kind = 'clear' AND EXISTS (SELECT 1 FROM public.practice_records
    WHERE user_id = attempt.profile_id AND recorded_date = attempt.recorded_date) THEN matched := false; END IF;
  IF matched THEN marker := 'applied'; END IF;
  -- Mark complete before the clear DELETE guard, in the same transaction. A
  -- marker/trigger failure rolls BOTH changes back to reserved, holding dispatch.
  UPDATE public.sheet_push_attempts SET state = 'completed', provider_complete = true, marker_status = marker,
    confirmed_at = clock_timestamp(), completed_at = clock_timestamp() WHERE attempt_id = p_attempt_id;
  IF matched AND attempt.kind = 'record' THEN
    UPDATE public.practice_records SET synced_at = clock_timestamp(), pending_sheet_push = false
      WHERE id = attempt.record_id AND user_id = attempt.profile_id AND recorded_date = attempt.recorded_date
        AND updated_at = attempt.expected_version RETURNING updated_at INTO resulting_version;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Sheet marker not applied'; END IF;
    UPDATE public.sheet_push_attempts SET marker_version = resulting_version WHERE attempt_id = p_attempt_id;
  ELSIF matched AND attempt.kind = 'clear' THEN
    DELETE FROM public.sheet_pending_clears WHERE user_id = attempt.profile_id AND recorded_date = attempt.recorded_date
      AND created_at = attempt.expected_version;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Sheet clear marker not applied'; END IF;
  END IF;
  RETURN jsonb_build_object('outcome', 'completed', 'marker_status', marker);
END;
$$;

-- No-provider resolution ONLY for a recreated DB record. Published CSV can lag:
-- an empty CSV is not proof of an empty actual sheet. Such queues stay held until
-- actual provider reconciliation; never create a row just to clear a missing row.
CREATE OR REPLACE FUNCTION public.sheet_clear_resolve(
  p_profile_id uuid, p_recorded_date date, p_expected_version timestamptz, p_expected_profile jsonb, p_target_slot text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE queued public.sheet_pending_clears%ROWTYPE; member public.profiles%ROWTYPE; current_profile jsonb; changed integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Service role required'; END IF;
  IF p_target_slot IS NULL OR p_target_slot !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid sheet clear target binding';
  END IF;
  SELECT * INTO queued FROM public.sheet_pending_clears
    WHERE user_id = p_profile_id AND recorded_date = p_recorded_date FOR UPDATE;
  IF NOT FOUND OR queued.created_at IS DISTINCT FROM p_expected_version THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_target_slot, 6101117));
  SELECT * INTO member FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  current_profile := jsonb_build_object('sheet_name', member.sheet_name, 'record_fields', member.record_fields,
    'sheet_transition', member.sheet_transition, 'sheet_header_signature', member.sheet_header_signature, 'record_source', member.record_source);
  IF current_profile IS DISTINCT FROM p_expected_profile THEN RETURN jsonb_build_object('outcome', 'stale'); END IF;
  IF EXISTS (SELECT 1 FROM public.sheet_push_attempts WHERE state <> 'completed'
    AND ((profile_id = p_profile_id AND recorded_date = p_recorded_date) OR target_slot = p_target_slot)) THEN
    RETURN jsonb_build_object('outcome', 'blocked');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.practice_records WHERE user_id = p_profile_id AND recorded_date = p_recorded_date) THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;
  DELETE FROM public.sheet_pending_clears WHERE user_id = p_profile_id AND recorded_date = p_recorded_date AND created_at = p_expected_version;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Sheet clear resolution not applied'; END IF;
  RETURN jsonb_build_object('outcome', 'resolved');
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_sheet_attempt_import() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE importing boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN importing := coalesce(NEW.from_sheet, false);
  ELSE importing := NEW.synced_at IS DISTINCT FROM OLD.synced_at AND
    (to_jsonb(NEW) - ARRAY['synced_at','updated_at','pending_sheet_push']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['synced_at','updated_at','pending_sheet_push']); END IF;
  IF NOT importing THEN RETURN NEW; END IF;
  -- Same profile lock as begin; checking only a prior SELECT would leave a race
  -- with a no-record clear reservation. Marker-only finish remains allowed.
  PERFORM 1 FROM public.profiles WHERE id = NEW.user_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.sheet_push_attempts WHERE state <> 'completed'
    AND (record_id = NEW.id OR (profile_id = NEW.user_id AND recorded_date = NEW.recorded_date)))
    OR EXISTS (SELECT 1 FROM public.sheet_pending_clears WHERE user_id = NEW.user_id AND recorded_date = NEW.recorded_date) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Unresolved sheet write must be reconciled before import';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_sheet_attempt_import ON public.practice_records;
CREATE TRIGGER guard_sheet_attempt_import BEFORE INSERT OR UPDATE ON public.practice_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_sheet_attempt_import();

CREATE OR REPLACE FUNCTION public.guard_sheet_attempt_clear_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = OLD.user_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.sheet_push_attempts WHERE state <> 'completed'
    AND profile_id = OLD.user_id AND recorded_date = OLD.recorded_date) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Unresolved sheet write must be reconciled before clearing queue';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS guard_sheet_attempt_clear_delete ON public.sheet_pending_clears;
CREATE TRIGGER guard_sheet_attempt_clear_delete BEFORE DELETE ON public.sheet_pending_clears
  FOR EACH ROW EXECUTE FUNCTION public.guard_sheet_attempt_clear_delete();

REVOKE ALL ON FUNCTION public.sheet_push_begin(uuid,text,uuid,uuid,date,timestamptz,jsonb,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sheet_push_finish(uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sheet_clear_resolve(uuid,date,timestamptz,jsonb,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_sheet_attempt_import() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_sheet_attempt_clear_delete() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sheet_push_begin(uuid,text,uuid,uuid,date,timestamptz,jsonb,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sheet_push_finish(uuid,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.sheet_clear_resolve(uuid,date,timestamptz,jsonb,text) TO service_role;
NOTIFY pgrst, 'reload schema';

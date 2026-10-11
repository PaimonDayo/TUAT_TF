-- PC-side evidence for an external Google mutation. Excluded from business
-- mirror/failover replay: copying/replaying this journal could create duplicate
-- workbooks. It remains in the encrypted public-schema backup/restore archive.
-- No token, schedule contents, expiry, takeover, or automatic provider retry.
CREATE TABLE IF NOT EXISTS public.google_sheet_creation_attempts (
  attempt_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL, -- retain external evidence across profile deletion
  connection_fingerprint text NOT NULL CHECK (connection_fingerprint ~ '^[0-9a-f]{64}$'),
  creation_fingerprint text NOT NULL CHECK (creation_fingerprint ~ '^[0-9a-f]{64}$'),
  registration_spec jsonb NOT NULL CHECK ((
    jsonb_typeof(registration_spec) = 'object'
    AND registration_spec ?& ARRAY['kind','block','year','month']
    AND (registration_spec - ARRAY['kind','block','year','month']) = '{}'::jsonb
    AND registration_spec->>'kind' IN ('practice','meet','time_trial')
    AND registration_spec->>'block' IN ('all','middle_long','short','jump','throw')
    AND CASE WHEN registration_spec->>'kind' = 'practice' THEN
      jsonb_typeof(registration_spec->'year') = 'number' AND (registration_spec->>'year')::integer BETWEEN 2000 AND 2100
      AND jsonb_typeof(registration_spec->'month') = 'number' AND (registration_spec->>'month')::integer BETWEEN 1 AND 12
    ELSE registration_spec->'year' = 'null'::jsonb AND registration_spec->'month' = 'null'::jsonb END
  ) IS TRUE),
  schedule_sheet_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','resource_known','registered')),
  spreadsheet_id text UNIQUE CHECK (spreadsheet_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  canonical_url text,
  setup_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resource_known_at timestamptz,
  registered_at timestamptz,
  UNIQUE(profile_id, connection_fingerprint, creation_fingerprint),
  CHECK ((state = 'reserved' AND spreadsheet_id IS NULL AND canonical_url IS NULL AND resource_known_at IS NULL AND NOT setup_confirmed)
    OR (state IN ('resource_known','registered') AND spreadsheet_id IS NOT NULL
      AND canonical_url IS NOT NULL AND canonical_url = 'https://docs.google.com/spreadsheets/d/' || spreadsheet_id || '/edit' AND resource_known_at IS NOT NULL)),
  CHECK ((state = 'registered') = (registered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS google_sheet_creation_owner_state ON public.google_sheet_creation_attempts(profile_id, state);
ALTER TABLE public.google_sheet_creation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_sheet_creation_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.google_sheet_creation_attempts TO authenticated;
GRANT SELECT ON public.google_sheet_creation_attempts TO service_role;
DROP POLICY IF EXISTS own_google_sheet_creation_evidence ON public.google_sheet_creation_attempts;
CREATE POLICY own_google_sheet_creation_evidence ON public.google_sheet_creation_attempts FOR SELECT TO authenticated
  USING (profile_id = auth.uid() AND public.login_access_allowed() AND public.is_member() AND public.can_create_schedule());

CREATE OR REPLACE FUNCTION public.google_sheet_creation_result(a public.google_sheet_creation_attempts, result_outcome text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE s public.schedule_sheets%ROWTYPE; record_status text := 'unregistered';
BEGIN
  IF a.state = 'registered' THEN
    SELECT * INTO s FROM public.schedule_sheets WHERE id = a.schedule_sheet_id;
    record_status := CASE WHEN NOT FOUND THEN 'deleted'
      WHEN s.author_id = a.profile_id AND s.sheet_url = a.canonical_url AND s.csv_url = a.canonical_url
        AND s.kind = a.registration_spec->>'kind' AND s.target_block = a.registration_spec->>'block'
        AND s.target_year IS NOT DISTINCT FROM (a.registration_spec->>'year')::integer
        AND s.target_month IS NOT DISTINCT FROM (a.registration_spec->>'month')::integer THEN 'present' ELSE 'changed' END;
  END IF;
  RETURN jsonb_build_object('outcome', result_outcome, 'attempt_id', a.attempt_id, 'state', a.state,
    'spec', a.registration_spec, 'setup_confirmed', a.setup_confirmed, 'record_status', record_status,
    'sheet_id', CASE WHEN a.state = 'registered' AND record_status = 'present' THEN a.schedule_sheet_id ELSE NULL END,
    'resource', CASE WHEN a.spreadsheet_id IS NULL THEN NULL ELSE jsonb_build_object('spreadsheetId', a.spreadsheet_id, 'url', a.canonical_url) END);
END $$;
REVOKE ALL ON FUNCTION public.google_sheet_creation_result(public.google_sheet_creation_attempts,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.google_sheet_creation_begin(p_attempt_id uuid, p_connected_at timestamptz,
  p_token_sha256 text, p_creation_fingerprint text, p_spec jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE actor uuid := auth.uid(); c public.google_drive_connections%ROWTYPE; a public.google_sheet_creation_attempts%ROWTYPE; fingerprint text;
BEGIN
  IF actor IS NULL OR public.login_access_allowed() IS NOT TRUE OR public.is_member() IS NOT TRUE
    OR public.can_create_schedule() IS NOT TRUE THEN RAISE EXCEPTION 'Creation permission denied' USING ERRCODE = '42501'; END IF;
  IF p_attempt_id IS NULL OR p_creation_fingerprint IS NULL OR p_creation_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid creation identity'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Creation profile unavailable'; END IF;
  -- Relink identity excludes mutable updated_at/access-token refresh bookkeeping.
  SELECT * INTO c FROM public.google_drive_connections WHERE profile_id = actor FOR SHARE;
  IF NOT FOUND OR p_connected_at IS DISTINCT FROM c.connected_at
    OR p_token_sha256 IS DISTINCT FROM encode(digest(c.refresh_token_encrypted, 'sha256'), 'hex') THEN RAISE EXCEPTION 'Google connection changed'; END IF;
  fingerprint := encode(digest(jsonb_build_array(actor, c.connected_at, p_token_sha256)::text, 'sha256'), 'hex');
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE profile_id = actor
    AND (state <> 'registered' OR NOT setup_confirmed) ORDER BY created_at, attempt_id LIMIT 1 FOR UPDATE;
  IF FOUND THEN RETURN public.google_sheet_creation_result(a, 'held'); END IF;
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE profile_id = actor
    AND connection_fingerprint = fingerprint AND creation_fingerprint = p_creation_fingerprint FOR UPDATE;
  IF FOUND THEN RETURN public.google_sheet_creation_result(a, 'registered'); END IF;
  -- An attempt nonce is never a dispatch permission on a repeated call.
  IF EXISTS (SELECT 1 FROM public.google_sheet_creation_attempts WHERE attempt_id = p_attempt_id) THEN RAISE EXCEPTION 'Creation attempt exists'; END IF;
  INSERT INTO public.google_sheet_creation_attempts(attempt_id,profile_id,connection_fingerprint,creation_fingerprint,registration_spec)
    VALUES(p_attempt_id,actor,fingerprint,p_creation_fingerprint,p_spec) RETURNING * INTO a;
  RETURN public.google_sheet_creation_result(a, 'send');
END $$;
REVOKE ALL ON FUNCTION public.google_sheet_creation_begin(uuid,timestamptz,text,text,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.google_sheet_creation_begin(uuid,timestamptz,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.google_sheet_creation_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE a public.google_sheet_creation_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.login_access_allowed() IS NOT TRUE OR public.is_member() IS NOT TRUE
    OR public.can_create_schedule() IS NOT TRUE THEN RAISE EXCEPTION 'Creation permission denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE profile_id = auth.uid()
    ORDER BY CASE WHEN state <> 'registered' OR NOT setup_confirmed THEN 0 ELSE 1 END, created_at DESC, attempt_id LIMIT 1;
  RETURN CASE WHEN FOUND THEN public.google_sheet_creation_result(a, CASE WHEN a.state = 'registered' AND a.setup_confirmed THEN 'registered' ELSE 'held' END) ELSE NULL END;
END $$;
REVOKE ALL ON FUNCTION public.google_sheet_creation_status() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.google_sheet_creation_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.google_sheet_creation_resource(p_attempt_id uuid,p_profile_id uuid,p_spreadsheet_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE a public.google_sheet_creation_attempts%ROWTYPE; conflicting boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE = '42501'; END IF;
  IF p_spreadsheet_id IS NULL OR p_spreadsheet_id !~ '^[A-Za-z0-9_-]{1,200}$' THEN RAISE EXCEPTION 'Invalid resource identity'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('google-sheet:' || p_spreadsheet_id, 0));
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE attempt_id = p_attempt_id AND profile_id = p_profile_id FOR UPDATE;
  IF NOT FOUND OR (a.spreadsheet_id IS NOT NULL AND a.spreadsheet_id <> p_spreadsheet_id) THEN RAISE EXCEPTION 'Creation resource mismatch'; END IF;
  UPDATE public.google_sheet_creation_attempts SET state = CASE WHEN state = 'reserved' THEN 'resource_known' ELSE state END,
    spreadsheet_id = p_spreadsheet_id, canonical_url = 'https://docs.google.com/spreadsheets/d/' || p_spreadsheet_id || '/edit',
    resource_known_at = COALESCE(resource_known_at, now()) WHERE attempt_id = a.attempt_id RETURNING * INTO a;
  SELECT EXISTS(SELECT 1 FROM public.schedule_sheets s WHERE
    (s.sheet_url ~ ('^https://docs[.]google[.]com/spreadsheets/(u/[0-9]+/)?d/' || p_spreadsheet_id || '([/?#]|$)')
      OR s.csv_url ~ ('^https://docs[.]google[.]com/spreadsheets/(u/[0-9]+/)?d/' || p_spreadsheet_id || '([/?#]|$)'))
    AND s.id <> a.schedule_sheet_id) INTO conflicting;
  RETURN public.google_sheet_creation_result(a, CASE WHEN conflicting THEN 'conflict' ELSE 'known' END);
END $$;
REVOKE ALL ON FUNCTION public.google_sheet_creation_resource(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_sheet_creation_resource(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.google_sheet_creation_setup(p_attempt_id uuid,p_profile_id uuid,p_spreadsheet_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE a public.google_sheet_creation_attempts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE attempt_id = p_attempt_id AND profile_id = p_profile_id FOR UPDATE;
  IF NOT FOUND OR a.state = 'reserved' OR a.spreadsheet_id IS DISTINCT FROM p_spreadsheet_id THEN RAISE EXCEPTION 'Creation resource mismatch'; END IF;
  UPDATE public.google_sheet_creation_attempts SET setup_confirmed = true WHERE attempt_id = a.attempt_id RETURNING * INTO a;
  RETURN public.google_sheet_creation_result(a, 'known');
END $$;
REVOKE ALL ON FUNCTION public.google_sheet_creation_setup(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_sheet_creation_setup(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_google_sheet_creation_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE resource text; a public.google_sheet_creation_attempts%ROWTYPE;
BEGIN
  FOR resource IN SELECT DISTINCT parts[1] FROM unnest(ARRAY[NEW.sheet_url,NEW.csv_url]) AS urls(value),
    LATERAL regexp_match(value, '^https://docs[.]google[.]com/spreadsheets/(?:u/[0-9]+/)?d/([A-Za-z0-9_-]+)(?:[/?#]|$)') AS matches(parts) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('google-sheet:' || resource, 0));
    SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE spreadsheet_id = resource;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- Normal metadata edits of this fully completed row use existing RLS;
    -- moving its PK or claiming another known creation still faces the guard.
    IF TG_OP = 'UPDATE' AND OLD.id = a.schedule_sheet_id AND NEW.id = OLD.id
      AND a.state = 'registered' AND a.setup_confirmed THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.schedule_sheets s WHERE s.id <> a.schedule_sheet_id AND
      (s.sheet_url ~ ('^https://docs[.]google[.]com/spreadsheets/(u/[0-9]+/)?d/' || resource || '([/?#]|$)')
        OR s.csv_url ~ ('^https://docs[.]google[.]com/spreadsheets/(u/[0-9]+/)?d/' || resource || '([/?#]|$)'))) THEN
      RAISE EXCEPTION 'Known creation resource already claimed' USING ERRCODE = '23514';
    END IF;
    IF (a.state = 'registered' AND a.setup_confirmed AND TG_OP = 'INSERT')
      OR NEW.id <> a.schedule_sheet_id OR NEW.author_id <> a.profile_id
      OR NEW.sheet_url IS DISTINCT FROM a.canonical_url OR NEW.csv_url IS DISTINCT FROM a.canonical_url
      OR NEW.kind IS DISTINCT FROM a.registration_spec->>'kind' OR NEW.target_block IS DISTINCT FROM a.registration_spec->>'block'
      OR NEW.target_year IS DISTINCT FROM (a.registration_spec->>'year')::integer
      OR NEW.target_month IS DISTINCT FROM (a.registration_spec->>'month')::integer THEN
      RAISE EXCEPTION 'Known creation registration mismatch' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_google_sheet_creation_registration() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS guard_google_sheet_creation_registration ON public.schedule_sheets;
CREATE TRIGGER guard_google_sheet_creation_registration BEFORE INSERT OR UPDATE ON public.schedule_sheets
  FOR EACH ROW EXECUTE FUNCTION public.guard_google_sheet_creation_registration();

CREATE OR REPLACE FUNCTION public.google_sheet_creation_register(p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE a public.google_sheet_creation_attempts%ROWTYPE; s public.schedule_sheets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.login_access_allowed() IS NOT TRUE OR public.is_member() IS NOT TRUE
    OR public.can_create_schedule() IS NOT TRUE THEN RAISE EXCEPTION 'Creation permission denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE attempt_id = p_attempt_id AND profile_id = auth.uid();
  IF NOT FOUND OR a.spreadsheet_id IS NULL THEN RAISE EXCEPTION 'Creation resource unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('google-sheet:' || a.spreadsheet_id, 0));
  SELECT * INTO a FROM public.google_sheet_creation_attempts WHERE attempt_id = p_attempt_id AND profile_id = auth.uid() FOR UPDATE;
  -- Completed rows may have been legitimately edited/deleted; never revive or reset them.
  IF a.state = 'registered' AND a.setup_confirmed THEN RETURN public.google_sheet_creation_result(a, 'registered'); END IF;
  IF EXISTS (SELECT 1 FROM public.schedule_sheets s WHERE s.id <> a.schedule_sheet_id AND
    (s.sheet_url ~ ('^https://docs[.]google[.]com/spreadsheets/(u/[0-9]+/)?d/' || a.spreadsheet_id || '([/?#]|$)')
      OR s.csv_url ~ ('^https://docs[.]google[.]com/spreadsheets/(u/[0-9]+/)?d/' || a.spreadsheet_id || '([/?#]|$)'))) THEN
    RAISE EXCEPTION 'Known creation resource already claimed' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO s FROM public.schedule_sheets WHERE id = a.schedule_sheet_id FOR UPDATE;
  IF FOUND THEN
    IF s.author_id <> a.profile_id OR s.sheet_url IS DISTINCT FROM a.canonical_url OR s.csv_url IS DISTINCT FROM a.canonical_url
      OR s.kind IS DISTINCT FROM a.registration_spec->>'kind' OR s.target_block IS DISTINCT FROM a.registration_spec->>'block'
      OR s.target_year IS DISTINCT FROM (a.registration_spec->>'year')::integer
      OR s.target_month IS DISTINCT FROM (a.registration_spec->>'month')::integer THEN RAISE EXCEPTION 'Existing registration changed'; END IF;
  ELSE
    INSERT INTO public.schedule_sheets(id,author_id,target_year,target_month,kind,target_block,sheet_url,csv_url)
      VALUES(a.schedule_sheet_id,a.profile_id,(a.registration_spec->>'year')::integer,(a.registration_spec->>'month')::integer,
        a.registration_spec->>'kind',a.registration_spec->>'block',a.canonical_url,a.canonical_url);
  END IF;
  UPDATE public.google_sheet_creation_attempts SET state = 'registered', registered_at = COALESCE(registered_at,now())
    WHERE attempt_id = a.attempt_id RETURNING * INTO a;
  RETURN public.google_sheet_creation_result(a, CASE WHEN a.setup_confirmed THEN 'registered' ELSE 'held' END);
END $$;
REVOKE ALL ON FUNCTION public.google_sheet_creation_register(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.google_sheet_creation_register(uuid) TO authenticated;

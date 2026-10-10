-- Apply the whole migration in one transaction. No object inventory/backfill.
-- A null confirmation is only a reference lock, never a cleanup candidate.
CREATE TABLE IF NOT EXISTS public.confirmed_image_retirements (
  bucket text NOT NULL CHECK (bucket IN ('avatars', 'note-images')),
  path text NOT NULL CHECK (path ~* '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(webp|jpe?g)$'),
  confirmed_at timestamptz,
  closed_at timestamptz,
  delete_after timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (bucket, path),
  CHECK ((closed_at IS NULL AND delete_after IS NULL) OR
    (confirmed_at IS NOT NULL AND closed_at IS NOT NULL AND delete_after >= closed_at + interval '7 days 10 minutes')),
  CHECK (deleted_at IS NULL OR closed_at IS NOT NULL)
);
ALTER TABLE public.confirmed_image_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.confirmed_image_retirements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.confirmed_image_retirements TO service_role;
CREATE INDEX IF NOT EXISTS confirmed_image_retirements_pending
  ON public.confirmed_image_retirements (confirmed_at, bucket, path)
  WHERE confirmed_at IS NOT NULL AND deleted_at IS NULL;

-- Conservatively recognize legacy public-Storage aliases too. An encoded alias
-- must take exactly the same lock as its bare path; external URLs are not listed.
CREATE OR REPLACE FUNCTION public.image_cleanup_avatar_path(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE raw text; decoded text; bytes bytea := ''::bytea; i integer := 1; piece text;
BEGIN
  IF value IS NULL OR length(value) > 2048 THEN RETURN NULL; END IF;
  IF value ~* '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(webp|jpe?g)$' THEN RETURN value; END IF;
  raw := substring(value FROM '(?i)^https?://[^/]+/storage/v1/object/public/avatars/([^?#]+)');
  IF raw IS NULL THEN RETURN NULL; END IF;
  WHILE i <= length(raw) LOOP
    piece := substring(raw FROM i FOR 1);
    IF piece = '%' THEN
      IF substring(raw FROM i + 1 FOR 2) !~ '^[0-9a-fA-F]{2}$' THEN RETURN NULL; END IF;
      bytes := bytes || decode(substring(raw FROM i + 1 FOR 2), 'hex'); i := i + 3;
    ELSE
      bytes := bytes || convert_to(piece, 'UTF8'); i := i + 1;
    END IF;
  END LOOP;
  decoded := convert_from(bytes, 'UTF8');
  IF decoded ~* '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(webp|jpe?g)$' THEN RETURN decoded; END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.image_cleanup_referenced(p_bucket text, p_path text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_bucket
    WHEN 'avatars' THEN EXISTS (SELECT 1 FROM public.profiles p
      WHERE public.image_cleanup_avatar_path(p.avatar_url) = p_path)
    WHEN 'note-images' THEN EXISTS (SELECT 1 FROM public.note_article_images i WHERE i.path = p_path)
    ELSE true END;
$$;

-- UPSERT, rather than checking a possibly absent row, is the transaction barrier.
-- The no-op UPDATE also makes stale REPEATABLE READ writers fail closed.
CREATE OR REPLACE FUNCTION public.image_cleanup_lock(p_bucket text, p_path text, assigning boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE retired timestamptz;
BEGIN
  INSERT INTO public.confirmed_image_retirements(bucket, path) VALUES(p_bucket, p_path)
  ON CONFLICT (bucket, path) DO UPDATE SET path = EXCLUDED.path
  RETURNING confirmed_at INTO retired;
  IF assigning AND retired IS NOT NULL THEN
    RAISE EXCEPTION 'This image has been retired; refresh before saving' USING ERRCODE = 'PT409';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_avatar_image_retirement()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous text; next_path text; p text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN previous := public.image_cleanup_avatar_path(OLD.avatar_url); END IF;
  IF TG_OP <> 'DELETE' THEN next_path := public.image_cleanup_avatar_path(NEW.avatar_url); END IF;
  FOR p IN SELECT DISTINCT v FROM unnest(ARRAY[previous,next_path]) v WHERE v IS NOT NULL ORDER BY v LOOP
    PERFORM public.image_cleanup_lock('avatars', p, p = next_path AND previous IS DISTINCT FROM next_path);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_avatar_image_retirement()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous text; next_path text;
BEGIN
  previous := public.image_cleanup_avatar_path(OLD.avatar_url);
  IF TG_OP <> 'DELETE' THEN next_path := public.image_cleanup_avatar_path(NEW.avatar_url); END IF;
  IF previous IS NOT NULL AND previous IS DISTINCT FROM next_path
     AND NOT public.image_cleanup_referenced('avatars', previous) THEN
    UPDATE public.confirmed_image_retirements SET confirmed_at = COALESCE(confirmed_at, clock_timestamp())
    WHERE bucket = 'avatars' AND path = previous;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS guard_avatar_image_retirement ON public.profiles;
CREATE TRIGGER guard_avatar_image_retirement BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_avatar_image_retirement();
DROP TRIGGER IF EXISTS confirm_avatar_image_retirement ON public.profiles;
CREATE TRIGGER confirm_avatar_image_retirement AFTER UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.confirm_avatar_image_retirement();

CREATE OR REPLACE FUNCTION public.guard_note_image_retirement()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous text; next_path text; p text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.path IS NOT DISTINCT FROM OLD.path THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN previous := OLD.path; END IF;
  IF TG_OP <> 'DELETE' THEN next_path := NEW.path; END IF;
  FOR p IN SELECT DISTINCT v FROM unnest(ARRAY[previous,next_path]) v WHERE v IS NOT NULL ORDER BY v LOOP
    PERFORM public.image_cleanup_lock('note-images', p, p = next_path AND previous IS DISTINCT FROM next_path);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.confirm_note_image_retirement()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR OLD.path IS DISTINCT FROM NEW.path)
     AND NOT public.image_cleanup_referenced('note-images', OLD.path) THEN
    UPDATE public.confirmed_image_retirements SET confirmed_at = COALESCE(confirmed_at, clock_timestamp())
    WHERE bucket = 'note-images' AND path = OLD.path;
  END IF;
  RETURN NULL;
END; $$;
-- After the existing article lock / six-photo guard for INSERT.
DROP TRIGGER IF EXISTS zz_guard_note_image_retirement ON public.note_article_images;
CREATE TRIGGER zz_guard_note_image_retirement BEFORE INSERT OR UPDATE OR DELETE ON public.note_article_images
FOR EACH ROW EXECUTE FUNCTION public.guard_note_image_retirement();
DROP TRIGGER IF EXISTS confirm_note_image_retirement ON public.note_article_images;
CREATE TRIGGER confirm_note_image_retirement AFTER UPDATE OR DELETE ON public.note_article_images
FOR EACH ROW EXECUTE FUNCTION public.confirm_note_image_retirement();

CREATE OR REPLACE FUNCTION public.avatar_image_is_retired(p_path text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.login_access_allowed() IS NOT TRUE OR public.is_member() IS NOT TRUE THEN
    RAISE EXCEPTION 'Image access denied' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.confirmed_image_retirements
    WHERE bucket = 'avatars' AND path = p_path AND closed_at IS NOT NULL);
END; $$;

-- Service-only bounded worker RPCs. A retirement is permanent even if R2 or its
-- acknowledgement is unavailable. Clock grace covers 330s GET + 2x120s skew.
CREATE OR REPLACE FUNCTION public.claim_confirmed_image_cleanup(p_bucket text, p_path text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.confirmed_image_retirements; utc timestamptz;
BEGIN
  SELECT * INTO r FROM public.confirmed_image_retirements
  WHERE bucket = p_bucket AND path = p_path FOR UPDATE;
  IF NOT FOUND OR r.confirmed_at IS NULL OR r.deleted_at IS NOT NULL
     OR public.image_cleanup_referenced(p_bucket,p_path) THEN RETURN NULL; END IF;
  IF r.closed_at IS NULL THEN
    utc := clock_timestamp(); -- after any lock wait and the zero-reference check
    UPDATE public.confirmed_image_retirements SET closed_at = utc, delete_after = utc + interval '7 days 10 minutes'
    WHERE bucket = p_bucket AND path = p_path RETURNING * INTO r;
  END IF;
  RETURN to_jsonb(r) || jsonb_build_object('server_utc', clock_timestamp());
END; $$;
CREATE OR REPLACE FUNCTION public.finish_confirmed_image_cleanup(p_bucket text, p_path text, p_closed_at timestamptz)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.confirmed_image_retirements;
BEGIN
  SELECT * INTO r FROM public.confirmed_image_retirements
  WHERE bucket = p_bucket AND path = p_path FOR UPDATE;
  IF NOT FOUND OR r.confirmed_at IS NULL OR r.closed_at IS NULL OR r.delete_after IS NULL OR r.closed_at IS DISTINCT FROM p_closed_at
     OR r.delete_after > clock_timestamp() OR public.image_cleanup_referenced(p_bucket,p_path) THEN RETURN false; END IF;
  UPDATE public.confirmed_image_retirements SET deleted_at = COALESCE(deleted_at, clock_timestamp())
  WHERE bucket = p_bucket AND path = p_path;
  RETURN true;
END; $$;
CREATE OR REPLACE FUNCTION public.confirmed_image_cleanup_target()
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('database', current_database(), 'system_identifier',
    (SELECT system_identifier::text FROM pg_control_system()),
    'schema_version', '20261011150000', 'server_utc', clock_timestamp());
$$;

REVOKE ALL ON FUNCTION public.image_cleanup_avatar_path(text), public.image_cleanup_referenced(text,text),
  public.image_cleanup_lock(text,text,boolean), public.guard_avatar_image_retirement(),
  public.confirm_avatar_image_retirement(), public.guard_note_image_retirement(),
  public.confirm_note_image_retirement(), public.avatar_image_is_retired(text),
  public.claim_confirmed_image_cleanup(text,text), public.finish_confirmed_image_cleanup(text,text,timestamptz),
  public.confirmed_image_cleanup_target() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avatar_image_is_retired(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_confirmed_image_cleanup(text,text),
  public.finish_confirmed_image_cleanup(text,text,timestamptz), public.confirmed_image_cleanup_target() TO service_role;
-- Existing note_image_cleanup table/rows/trigger are deliberately unchanged.
NOTIFY pgrst, 'reload schema';

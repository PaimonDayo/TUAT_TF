ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mention_reading TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_mention_reading_length;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_mention_reading_length
  CHECK (mention_reading IS NULL OR char_length(mention_reading) <= 80);

CREATE OR REPLACE FUNCTION public.set_profile_mention_reading(
  target_profile_id UUID,
  new_reading TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized TEXT;
BEGIN
  IF NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;

  normalized := NULLIF(trim(regexp_replace(COALESCE(new_reading, ''), '\s+', ' ', 'g')), '');

  IF normalized IS NOT NULL
     AND normalized !~ U&'^[\3041-\3096\30FC\309D\309E\30FB ]+$' THEN
    RAISE EXCEPTION 'mention reading must be hiragana';
  END IF;

  UPDATE public.profiles
  SET mention_reading = normalized
  WHERE id = target_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_mention_reading(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_mention_reading(UUID, TEXT) TO authenticated;

-- Computed field: filter before pagination without modifying saved records.
-- Unnamed row argument prevents exposing this helper as a callable RPC.
CREATE OR REPLACE FUNCTION public.record_has_content(public.practice_records)
RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    COALESCE($1.dist_low, 0) > 0 OR COALESCE($1.dist_mid, 0) > 0
    OR COALESCE($1.dist_high, 0) > 0 OR COALESCE($1.dist_speed, 0) > 0
    OR COALESCE($1.dist_actual, 0) > 0 OR COALESCE($1.strides, 0) > 0
    OR EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        $1.result_text, $1.strength_text, $1.memo, $1.menu_text, $1.focus_text,
        $1.condition::text
      ]) AS field(value)
      WHERE COALESCE(field.value, '') ~ '[^[:space:]]'
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_each_text(
        CASE WHEN jsonb_typeof($1.custom) = 'object' THEN $1.custom ELSE '{}'::jsonb END
      ) AS field(key, value)
      WHERE COALESCE(field.value, '') ~ '[^[:space:]]'
        AND field.value !~ '^[[:space:]]*[+-]?0+(\.0+)?[[:space:]]*$'
    );
$$;

-- Regression fixtures use composite values only: no production rows are written.
DO $$
DECLARE fixture jsonb;
BEGIN
  FOREACH fixture IN ARRAY ARRAY[
    '{}'::jsonb,
    '{"custom":{"other":null}}'::jsonb,
    '{"custom":{"other":"0","state":null}}'::jsonb,
    '{"custom":{"other":0,"state":"  "}}'::jsonb,
    '{"custom":{"other":" 0.00 "},"memo":" "}'::jsonb
  ] LOOP
    IF public.record_has_content(jsonb_populate_record(NULL::public.practice_records, fixture)) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Empty record fixture must not appear';
    END IF;
  END LOOP;
  FOREACH fixture IN ARRAY ARRAY[
    '{"custom":{"other":"独り言"}}'::jsonb,
    '{"custom":{"other":"0から再開"}}'::jsonb,
    '{"custom":{"other":0.1}}'::jsonb,
    '{"dist_low":3.51}'::jsonb,
    '{"memo":"休養"}'::jsonb
  ] LOOP
    IF public.record_has_content(jsonb_populate_record(NULL::public.practice_records, fixture)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Nonempty record fixture must remain visible';
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

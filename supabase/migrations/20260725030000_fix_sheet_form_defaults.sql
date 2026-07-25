-- Remove spreadsheet-computed weekly totals from the current form configuration and
-- repair the first rollout default so an exact 感想 field starts visible on timeline.
-- Practice-record snapshots are intentionally left untouched.
WITH rewritten AS (
  SELECT
    profile.id,
    COALESCE(
      jsonb_agg(
        CASE
          WHEN regexp_replace(COALESCE(field.value->>'sourceHeader', field.value->>'label', ''), '\s+', '', 'g') = '感想'
            THEN jsonb_set(field.value, '{showInTimeline}', 'true'::jsonb, true)
          ELSE field.value
        END
        ORDER BY field.ordinality
      ) FILTER (
        WHERE regexp_replace(COALESCE(field.value->>'sourceHeader', field.value->>'label', ''), '\s+', '', 'g') NOT LIKE '%週合計%'
      ),
      '[]'::jsonb
    ) AS fields
  FROM public.profiles AS profile
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(profile.record_fields, '[]'::jsonb)) WITH ORDINALITY AS field(value, ordinality)
  WHERE NULLIF(BTRIM(profile.sheet_name), '') IS NOT NULL
  GROUP BY profile.id
)
UPDATE public.profiles AS profile
SET record_fields = rewritten.fields
FROM rewritten
WHERE profile.id = rewritten.id
  AND profile.record_fields IS DISTINCT FROM rewritten.fields;
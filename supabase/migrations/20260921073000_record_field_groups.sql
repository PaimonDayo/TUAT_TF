-- Deduplicate definitions across a page without expanding access to form history.
CREATE OR REPLACE FUNCTION public.get_record_field_groups(requested_record_ids uuid[])
RETURNS TABLE(record_ids uuid[], record_fields_version integer, fields jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT array_agg(r.id ORDER BY r.id), r.record_fields_version,
    COALESCE(CASE WHEN r.record_fields_version IS NOT NULL
      THEN r.record_fields_snapshot ELSE p.record_fields END, '[]'::jsonb)
  FROM public.practice_records r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.id = ANY(COALESCE($1, ARRAY[]::uuid[]))
  GROUP BY r.record_fields_version,
    COALESCE(CASE WHEN r.record_fields_version IS NOT NULL
      THEN r.record_fields_snapshot ELSE p.record_fields END, '[]'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.get_record_field_groups(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_record_field_groups(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';

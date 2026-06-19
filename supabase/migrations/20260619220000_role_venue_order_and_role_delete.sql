ALTER TABLE roles
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY is_system DESC, created_at ASC, id ASC
    )::INTEGER AS position
  FROM roles
)
UPDATE roles
SET sort_order = ordered.position
FROM ordered
WHERE roles.id = ordered.id
  AND roles.sort_order = 0;

CREATE OR REPLACE FUNCTION public.reorder_roles(role_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE roles AS role
  SET sort_order = ordered.position
  FROM unnest(role_ids) WITH ORDINALITY AS ordered(id, position)
  WHERE role.id = ordered.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_venues(venue_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_create_schedule() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE venues AS venue
  SET sort = ordered.position
  FROM unnest(venue_ids) WITH ORDINALITY AS ordered(id, position)
  WHERE venue.id = ordered.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_role(target_role_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM roles
    WHERE id = target_role_id
      AND is_system
  ) THEN
    RAISE EXCEPTION 'system roles cannot be deleted';
  END IF;

  DELETE FROM profile_roles
  WHERE role_id = target_role_id;

  DELETE FROM roles
  WHERE id = target_role_id
    AND NOT is_system;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_roles(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_venues(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_custom_role(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reorder_roles(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_venues(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_role(UUID) TO authenticated;

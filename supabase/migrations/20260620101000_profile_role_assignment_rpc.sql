CREATE OR REPLACE FUNCTION public.set_profile_roles(
  target_profile_id UUID,
  target_role_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  DELETE FROM profile_roles
  WHERE profile_id = target_profile_id;

  INSERT INTO profile_roles (profile_id, role_id)
  SELECT target_profile_id, role_id
  FROM unnest(COALESCE(target_role_ids, '{}'::UUID[])) AS role_id
  WHERE EXISTS (
    SELECT 1
    FROM roles
    WHERE roles.id = role_id
  )
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_roles(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_roles(UUID, UUID[]) TO authenticated;

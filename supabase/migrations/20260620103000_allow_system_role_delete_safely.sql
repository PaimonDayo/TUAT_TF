CREATE OR REPLACE FUNCTION public.delete_custom_role(target_role_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
  target_can_manage BOOLEAN;
  remaining_managers INTEGER;
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT can_manage_members
  INTO target_can_manage
  FROM roles
  WHERE id = target_role_id;

  IF target_can_manage IS NULL THEN
    RETURN FALSE;
  END IF;

  IF target_can_manage THEN
    SELECT COUNT(DISTINCT profile_roles.profile_id)
    INTO remaining_managers
    FROM profile_roles
    JOIN roles ON roles.id = profile_roles.role_id
    WHERE roles.can_manage_members
      AND roles.id <> target_role_id;

    IF remaining_managers = 0 THEN
      RAISE EXCEPTION 'cannot remove the last member manager role';
    END IF;
  END IF;

  DELETE FROM profile_roles
  WHERE role_id = target_role_id;

  DELETE FROM roles
  WHERE id = target_role_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_custom_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_custom_role(UUID) TO authenticated;

-- Keep role protection and the last system manager invariant at the DB boundary.
-- The same transaction lock precedes role row locks and every assignment RPC.
CREATE OR REPLACE FUNCTION public.guard_system_permission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_write boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF TG_LEVEL = 'STATEMENT' THEN
    PERFORM pg_advisory_xact_lock(74291, 1);
    RETURN NULL;
  END IF;

  IF public.is_mirror_write() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Recheck after the statement lock, including a request whose RLS snapshot
  -- predates another transaction's removal of the caller's management role.
  IF NOT service_write AND NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'member management permission required' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system OR NEW.is_everyone THEN
      RAISE EXCEPTION 'protected roles cannot be created by this operation' USING ERRCODE = '42501';
    END IF;
    IF NEW.can_manage_system AND NOT service_write AND NOT public.can_manage_system() THEN
      RAISE EXCEPTION 'system management permission required' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_system IS DISTINCT FROM OLD.is_system
       OR NEW.is_everyone IS DISTINCT FROM OLD.is_everyone THEN
      RAISE EXCEPTION 'role protection cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.can_manage_system IS NOT DISTINCT FROM OLD.can_manage_system THEN RETURN NEW; END IF;
  ELSE
    IF OLD.is_system OR OLD.is_everyone THEN
      RAISE EXCEPTION 'protected roles cannot be deleted' USING ERRCODE = '42501';
    END IF;
    IF OLD.can_manage_members AND NOT EXISTS (
      SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
      WHERE r.can_manage_members AND r.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'cannot remove the last member manager role';
    END IF;
    IF NOT OLD.can_manage_system THEN RETURN OLD; END IF;
  END IF;

  IF NOT service_write AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required' USING ERRCODE = '42501';
  END IF;
  IF OLD.can_manage_system AND NOT EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE r.can_manage_system AND r.id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'cannot remove the last system manager role';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_system_permission_lock ON public.roles;
CREATE TRIGGER guard_system_permission_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_system_permission_change();
DROP TRIGGER IF EXISTS guard_system_permission_change ON public.roles;
CREATE TRIGGER guard_system_permission_change
BEFORE INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.guard_system_permission_change();

DROP POLICY IF EXISTS roles_delete ON public.roles;
CREATE POLICY roles_delete ON public.roles FOR DELETE TO authenticated
USING (public.can_manage_members() AND NOT is_system AND NOT is_everyone);

CREATE OR REPLACE FUNCTION public.set_profile_roles(target_profile_id uuid, target_role_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_system_roles uuid[];
  requested_system_roles uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(74291, 1);
  IF NOT public.can_manage_members() THEN RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_profile_id) THEN
    RAISE EXCEPTION 'profile not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(target_role_ids, '{}'::uuid[])) requested(id)
    WHERE requested.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = requested.id)
  ) THEN RAISE EXCEPTION 'role not found'; END IF;

  SELECT COALESCE(array_agg(r.id ORDER BY r.id), '{}'::uuid[]) INTO current_system_roles
  FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
  WHERE pr.profile_id = target_profile_id AND r.can_manage_system;
  SELECT COALESCE(array_agg(r.id ORDER BY r.id), '{}'::uuid[]) INTO requested_system_roles
  FROM public.roles r
  WHERE r.id = ANY(COALESCE(target_role_ids, '{}'::uuid[])) AND r.can_manage_system AND NOT r.is_everyone;
  IF current_system_roles IS DISTINCT FROM requested_system_roles AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required' USING ERRCODE = '42501';
  END IF;
  IF cardinality(current_system_roles) > 0 AND cardinality(requested_system_roles) = 0 AND NOT EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id <> target_profile_id AND r.can_manage_system
  ) THEN RAISE EXCEPTION 'cannot remove the last system manager'; END IF;

  DELETE FROM public.profile_roles WHERE profile_id = target_profile_id;
  INSERT INTO public.profile_roles(profile_id, role_id)
  SELECT target_profile_id, r.id FROM public.roles r
  WHERE r.id = ANY(COALESCE(target_role_ids, '{}'::uuid[])) AND NOT r.is_everyone
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_role_members(target_role_id uuid, target_profile_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role public.roles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(74291, 1);
  IF NOT public.can_manage_members() THEN RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO target_role FROM public.roles WHERE id = target_role_id;
  IF target_role.id IS NULL OR target_role.is_everyone THEN RAISE EXCEPTION 'role cannot be assigned'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(target_profile_ids, '{}'::uuid[])) requested(id)
    WHERE requested.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = requested.id)
  ) THEN RAISE EXCEPTION 'profile not found'; END IF;
  IF target_role.can_manage_system AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required' USING ERRCODE = '42501';
  END IF;
  IF target_role.can_manage_system AND cardinality(COALESCE(target_profile_ids, '{}'::uuid[])) = 0 AND NOT EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE r.can_manage_system AND r.id <> target_role_id
  ) THEN RAISE EXCEPTION 'cannot remove the last system manager'; END IF;
  IF target_role.can_manage_members AND cardinality(COALESCE(target_profile_ids, '{}'::uuid[])) = 0 AND NOT EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE r.can_manage_members AND r.id <> target_role_id
  ) THEN RAISE EXCEPTION 'cannot remove the last member manager'; END IF;

  DELETE FROM public.profile_roles WHERE role_id = target_role_id;
  INSERT INTO public.profile_roles(profile_id, role_id)
  SELECT p.id, target_role_id FROM public.profiles p
  WHERE p.id = ANY(COALESCE(target_profile_ids, '{}'::uuid[]))
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_custom_role(target_role_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role public.roles%ROWTYPE;
  deleted_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(74291, 1);
  IF NOT public.can_manage_members() THEN RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO target_role FROM public.roles WHERE id = target_role_id;
  IF target_role.id IS NULL THEN RETURN FALSE; END IF;
  IF target_role.is_system OR target_role.is_everyone THEN RAISE EXCEPTION 'protected roles cannot be deleted'; END IF;
  -- DELETE runs the same row guard as a direct table delete before FK cascades.
  DELETE FROM public.roles WHERE id = target_role_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_roles(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_role_members(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_custom_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_roles(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_role_members(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_custom_role(uuid) TO authenticated;

-- Preserve automatic registration, normal own-profile edits, and service jobs.
-- Authority comes from signed claims / can_*(), never a definer's current_user.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_role text := COALESCE(auth.jwt() ->> 'role', '');
  claim_email text := auth.jwt() ->> 'email';
BEGIN
  IF public.is_mirror_write() OR claim_role = 'service_role' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF (
      (auth.uid() = NEW.id AND claim_email IS NOT NULL AND NEW.email = claim_email)
      OR (claim_role = '' AND session_user IN ('postgres', 'supabase_auth_admin') AND EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id = NEW.id AND u.email = NEW.email
      ))
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'profile identity must match the authenticated account' USING ERRCODE = '42501';
    END IF;
    IF NEW.role IS DISTINCT FROM 'member' OR NEW.approved IS DISTINCT FROM TRUE
       OR NEW.status IS DISTINCT FROM 'active' OR NEW.mention_reading IS NOT NULL
       OR NEW.created_at IS DISTINCT FROM transaction_timestamp() THEN
      RAISE EXCEPTION 'new profiles must use the normal registration defaults' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'profile identity fields require service management' USING ERRCODE = '42501';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email AND (
    auth.uid() = OLD.id AND claim_email IS NOT NULL AND NEW.email = claim_email
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'profile email must match the authenticated account' USING ERRCODE = '42501';
  END IF;
  IF (NEW.approved IS DISTINCT FROM OLD.approved OR NEW.status IS DISTINCT FROM OLD.status)
     AND NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'member management permission required' USING ERRCODE = '42501';
  END IF;
  IF NEW.mention_reading IS DISTINCT FROM OLD.mention_reading AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();

ALTER TABLE public.profiles ALTER COLUMN approved SET DEFAULT TRUE;
ALTER POLICY profiles_update_own ON public.profiles
USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

REVOKE ALL ON FUNCTION public.guard_system_permission_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM PUBLIC, anon, authenticated;

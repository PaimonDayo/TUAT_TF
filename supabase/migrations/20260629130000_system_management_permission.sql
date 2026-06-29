-- 最上位権限「システム管理」と、システム管理者の自己投稿通知を追加する。

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS can_manage_system BOOLEAN NOT NULL DEFAULT FALSE;

-- 既存の組込「管理者」を初期システム管理者にする。
UPDATE public.roles
SET can_manage_system = TRUE
WHERE name = '管理者' AND is_system = TRUE;

CREATE OR REPLACE FUNCTION public.can_manage_system()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_roles pr
    JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id = auth.uid()
      AND r.can_manage_system = TRUE
  );
$$;

-- システム管理フラグそのものを、通常の部員管理者が書き換えないよう防ぐ。
CREATE OR REPLACE FUNCTION public.guard_system_permission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_system_managers INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.can_manage_system AND NOT public.can_manage_system() THEN
      RAISE EXCEPTION 'system management permission required';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.can_manage_system IS DISTINCT FROM OLD.can_manage_system THEN
    IF NOT public.can_manage_system() THEN
      RAISE EXCEPTION 'system management permission required';
    END IF;

    IF OLD.can_manage_system AND NOT NEW.can_manage_system THEN
      SELECT COUNT(DISTINCT pr.profile_id)
      INTO remaining_system_managers
      FROM public.profile_roles pr
      JOIN public.roles r ON r.id = pr.role_id
      WHERE r.can_manage_system = TRUE
        AND r.id <> OLD.id;

      IF remaining_system_managers = 0 THEN
        RAISE EXCEPTION 'cannot remove the last system manager role';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_system_permission_change ON public.roles;
CREATE TRIGGER guard_system_permission_change
BEFORE INSERT OR UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.guard_system_permission_change();

-- ロール割当はRPCに一本化し、システム管理権限の付与・解除と最後の管理者を保護する。
DROP POLICY IF EXISTS "profile_roles_insert" ON public.profile_roles;
DROP POLICY IF EXISTS "profile_roles_delete" ON public.profile_roles;

CREATE OR REPLACE FUNCTION public.set_profile_roles(
  target_profile_id UUID,
  target_role_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_has_system BOOLEAN;
  requested_has_system BOOLEAN;
  remaining_system_managers INTEGER;
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profile_roles pr
    JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id = target_profile_id
      AND r.can_manage_system = TRUE
  ) INTO current_has_system;

  SELECT EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.id = ANY(COALESCE(target_role_ids, '{}'::UUID[]))
      AND r.can_manage_system = TRUE
  ) INTO requested_has_system;

  IF current_has_system IS DISTINCT FROM requested_has_system
     AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;

  IF current_has_system AND NOT requested_has_system THEN
    SELECT COUNT(DISTINCT pr.profile_id)
    INTO remaining_system_managers
    FROM public.profile_roles pr
    JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id <> target_profile_id
      AND r.can_manage_system = TRUE;

    IF remaining_system_managers = 0 THEN
      RAISE EXCEPTION 'cannot remove the last system manager';
    END IF;
  END IF;

  DELETE FROM public.profile_roles
  WHERE profile_id = target_profile_id;

  INSERT INTO public.profile_roles (profile_id, role_id)
  SELECT target_profile_id, role_id
  FROM unnest(COALESCE(target_role_ids, '{}'::UUID[])) AS role_id
  WHERE EXISTS (SELECT 1 FROM public.roles WHERE roles.id = role_id)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_roles(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_roles(UUID, UUID[]) TO authenticated;

-- システム管理を含むカスタムロールの削除も最上位権限で保護する。
CREATE OR REPLACE FUNCTION public.delete_custom_role(target_role_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
  target_is_system BOOLEAN;
  target_can_manage_members BOOLEAN;
  target_can_manage_system BOOLEAN;
  remaining_managers INTEGER;
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT is_system, can_manage_members, can_manage_system
  INTO target_is_system, target_can_manage_members, target_can_manage_system
  FROM public.roles
  WHERE id = target_role_id;

  IF target_is_system IS NULL THEN RETURN FALSE; END IF;
  IF target_is_system THEN RAISE EXCEPTION 'system roles cannot be deleted'; END IF;
  IF target_can_manage_system AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;

  IF target_can_manage_members THEN
    SELECT COUNT(DISTINCT pr.profile_id)
    INTO remaining_managers
    FROM public.profile_roles pr
    JOIN public.roles r ON r.id = pr.role_id
    WHERE r.can_manage_members = TRUE
      AND r.id <> target_role_id;
    IF remaining_managers = 0 THEN
      RAISE EXCEPTION 'cannot remove the last member manager role';
    END IF;
  END IF;

  IF target_can_manage_system THEN
    SELECT COUNT(DISTINCT pr.profile_id)
    INTO remaining_managers
    FROM public.profile_roles pr
    JOIN public.roles r ON r.id = pr.role_id
    WHERE r.can_manage_system = TRUE
      AND r.id <> target_role_id;
    IF remaining_managers = 0 THEN
      RAISE EXCEPTION 'cannot remove the last system manager role';
    END IF;
  END IF;

  DELETE FROM public.profile_roles WHERE role_id = target_role_id;
  DELETE FROM public.roles WHERE id = target_role_id AND NOT is_system;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_custom_role(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_custom_role(UUID) TO authenticated;

-- 通常投稿者は従来どおり自己通知なし。システム管理者だけ自己投稿も通知する。
CREATE OR REPLACE FUNCTION public.handle_notice_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.notify_members THEN
    INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT DISTINCT p.id, NEW.author_id, 'notice', 'notice', NEW.id
    FROM public.profiles p
    WHERE p.status = 'active'
      AND p.approved = TRUE
      AND p.notify_notice = TRUE
      AND (
        (
          p.id = NEW.author_id
          AND EXISTS (
            SELECT 1
            FROM public.profile_roles pr
            JOIN public.roles r ON r.id = pr.role_id
            WHERE pr.profile_id = NEW.author_id
              AND r.can_manage_system = TRUE
          )
        )
        OR (
          p.id <> NEW.author_id
          AND (
            cardinality(NEW.target_role_ids) = 0
            OR EXISTS (
              SELECT 1
              FROM public.profile_roles pr
              WHERE pr.profile_id = p.id
                AND pr.role_id = ANY(NEW.target_role_ids)
            )
          )
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

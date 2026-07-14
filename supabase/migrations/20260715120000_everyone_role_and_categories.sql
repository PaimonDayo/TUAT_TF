-- 全ユーザーへ自動適用する @everyone 相当ロールと、ロールカテゴリのマスタを追加する。

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS is_everyone BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS roles_single_everyone
  ON public.roles (is_everyone)
  WHERE is_everyone = TRUE;

INSERT INTO public.roles (
  name, can_manage_members, can_create_schedule, can_create_menu,
  can_create_notice, can_manage_system, is_system, is_everyone,
  color, category, sort_order
)
SELECT '全員', FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE,
       '#8e8e93', NULL, 0
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE is_everyone = TRUE);

CREATE TABLE IF NOT EXISTS public.role_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 20),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.role_categories (name, sort_order)
SELECT category, row_number() OVER (ORDER BY min(sort_order), category)::INTEGER
FROM public.roles
WHERE category IS NOT NULL AND trim(category) <> ''
GROUP BY category
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.role_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "role_categories_select" ON public.role_categories;
DROP POLICY IF EXISTS "role_categories_insert" ON public.role_categories;
DROP POLICY IF EXISTS "role_categories_update" ON public.role_categories;
DROP POLICY IF EXISTS "role_categories_delete" ON public.role_categories;
CREATE POLICY "role_categories_select" ON public.role_categories FOR SELECT USING (TRUE);
CREATE POLICY "role_categories_insert" ON public.role_categories FOR INSERT WITH CHECK (public.can_manage_members());
CREATE POLICY "role_categories_update" ON public.role_categories FOR UPDATE USING (public.can_manage_members());
CREATE POLICY "role_categories_delete" ON public.role_categories FOR DELETE USING (public.can_manage_members());

CREATE OR REPLACE FUNCTION public.can_manage_members()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_manage_members
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_schedule()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_create_schedule
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_menu()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_create_menu
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_notice()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_create_notice
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_system()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_manage_system
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

-- 全員ロールは個別割当テーブルへ保存しない。権限は自動適用される。
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
  IF NOT public.can_manage_members() THEN RAISE EXCEPTION 'permission denied'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id = target_profile_id AND r.can_manage_system
  ) INTO current_has_system;

  SELECT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = ANY(COALESCE(target_role_ids, '{}'::UUID[]))
      AND r.can_manage_system AND NOT r.is_everyone
  ) INTO requested_has_system;

  IF current_has_system IS DISTINCT FROM requested_has_system AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;

  IF current_has_system AND NOT requested_has_system THEN
    SELECT COUNT(DISTINCT pr.profile_id) INTO remaining_system_managers
    FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id <> target_profile_id AND r.can_manage_system;
    IF remaining_system_managers = 0 THEN RAISE EXCEPTION 'cannot remove the last system manager'; END IF;
  END IF;

  DELETE FROM public.profile_roles WHERE profile_id = target_profile_id;
  INSERT INTO public.profile_roles (profile_id, role_id)
  SELECT target_profile_id, role.id
  FROM public.roles role
  WHERE role.id = ANY(COALESCE(target_role_ids, '{}'::UUID[]))
    AND NOT role.is_everyone
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_roles(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_roles(UUID, UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_everyone_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_everyone AND (NEW.can_manage_system OR NEW.can_manage_members) THEN
    RAISE EXCEPTION 'everyone role cannot grant administrative permissions';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_everyone AND NOT NEW.is_everyone THEN
    RAISE EXCEPTION 'everyone role cannot be converted';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_everyone_role ON public.roles;
CREATE TRIGGER guard_everyone_role
BEFORE INSERT OR UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.guard_everyone_role();
-- ロール側から所属メンバーを一括更新する。1 RPCで原子的に反映し、他ロールは保持する。
CREATE OR REPLACE FUNCTION public.set_role_members(
  target_role_id UUID,
  target_profile_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role public.roles%ROWTYPE;
  remaining_system_managers INTEGER;
  remaining_member_managers INTEGER;
BEGIN
  IF NOT public.can_manage_members() THEN RAISE EXCEPTION 'permission denied'; END IF;
  SELECT * INTO target_role FROM public.roles WHERE id = target_role_id;
  IF target_role.id IS NULL OR target_role.is_everyone THEN RAISE EXCEPTION 'role cannot be assigned'; END IF;
  IF target_role.can_manage_system AND NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;
  IF target_role.can_manage_system THEN
    SELECT COUNT(DISTINCT profile_id) INTO remaining_system_managers
    FROM (
      SELECT pr.profile_id
      FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
      WHERE r.can_manage_system AND r.id <> target_role_id
      UNION
      SELECT unnest(COALESCE(target_profile_ids, '{}'::UUID[]))
    ) managers;
    IF remaining_system_managers = 0 THEN RAISE EXCEPTION 'cannot remove the last system manager'; END IF;
  END IF;
  IF target_role.can_manage_members THEN
    SELECT COUNT(DISTINCT profile_id) INTO remaining_member_managers
    FROM (
      SELECT pr.profile_id
      FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
      WHERE r.can_manage_members AND r.id <> target_role_id
      UNION
      SELECT unnest(COALESCE(target_profile_ids, '{}'::UUID[]))
    ) managers;
    IF remaining_member_managers = 0 THEN RAISE EXCEPTION 'cannot remove the last member manager'; END IF;
  END IF;

  DELETE FROM public.profile_roles WHERE role_id = target_role_id;
  INSERT INTO public.profile_roles (profile_id, role_id)
  SELECT profile.id, target_role_id
  FROM public.profiles profile
  WHERE profile.id = ANY(COALESCE(target_profile_ids, '{}'::UUID[]))
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.set_role_members(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_role_members(UUID, UUID[]) TO authenticated;
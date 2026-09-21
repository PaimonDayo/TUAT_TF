CREATE OR REPLACE FUNCTION public.can_create_notice()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_create_notice
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_menu()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_create_menu
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_schedule()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_create_schedule
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_members()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_manage_members
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_system()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.can_manage_system
      AND (r.is_everyone OR EXISTS (
        SELECT 1 FROM public.profile_roles pr
        WHERE pr.role_id = r.id AND pr.profile_id = auth.uid()
      ))
  );
$$;

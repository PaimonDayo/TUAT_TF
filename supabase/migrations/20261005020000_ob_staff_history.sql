-- OB staff can read the existing audit trails without receiving UPDATE/DELETE permissions.
-- Keep administrators' existing access and all audit/failover records unchanged.
DROP POLICY IF EXISTS ob_entry_changes_system_read ON public.ob_entry_changes;
CREATE POLICY ob_entry_changes_system_read ON public.ob_entry_changes FOR SELECT TO authenticated
  USING (public.can_manage_system() OR public.can_manage_members() OR public.can_manage_ob_meet());

DROP POLICY IF EXISTS ob_operation_changes_system_read ON public.ob_operation_changes;
CREATE POLICY ob_operation_changes_system_read ON public.ob_operation_changes FOR SELECT TO authenticated
  USING (public.can_manage_system() OR public.can_manage_ob_meet());
CREATE INDEX IF NOT EXISTS ob_operation_changes_recent_idx ON public.ob_operation_changes(changed_at DESC, id DESC);

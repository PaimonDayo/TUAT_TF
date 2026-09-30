-- Existing notices already participates in failover logging and full-column mirroring.
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS system_only boolean NOT NULL DEFAULT false;
DROP POLICY IF EXISTS notices_system_visibility ON public.notices;
CREATE POLICY notices_system_visibility ON public.notices AS RESTRICTIVE FOR SELECT
USING (NOT system_only OR public.can_manage_system());

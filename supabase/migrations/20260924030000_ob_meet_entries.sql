-- 初期公開はシステム管理権限のみ。一般部員への公開は別の明示的な変更とする。
CREATE TABLE IF NOT EXISTS public.ob_meet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meet_key text NOT NULL,
  submitted_name text NOT NULL CHECK (length(btrim(submitted_name)) BETWEEN 1 AND 100),
  grade text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meet_key, submitted_name)
);
CREATE UNIQUE INDEX IF NOT EXISTS ob_meet_entries_profile_unique
  ON public.ob_meet_entries(meet_key, profile_id) WHERE profile_id IS NOT NULL;
ALTER TABLE public.ob_meet_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_meet_entries FROM anon, authenticated;
GRANT SELECT ON public.ob_meet_entries TO authenticated;
GRANT UPDATE (profile_id, revision) ON public.ob_meet_entries TO authenticated;
GRANT ALL ON public.ob_meet_entries TO service_role;
DROP POLICY IF EXISTS ob_meet_entries_system_read ON public.ob_meet_entries;
CREATE POLICY ob_meet_entries_system_read ON public.ob_meet_entries
  FOR SELECT TO authenticated USING (public.can_manage_system());
DROP POLICY IF EXISTS ob_meet_entries_system_update ON public.ob_meet_entries;
CREATE POLICY ob_meet_entries_system_update ON public.ob_meet_entries
  FOR UPDATE TO authenticated USING (public.can_manage_system()) WITH CHECK (public.can_manage_system());
NOTIFY pgrst, 'reload schema';

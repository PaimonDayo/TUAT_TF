-- 新規ログインを既存部員の自動承認にせず、部員管理権限者の承認までRLSで遮断する。
-- 既存プロフィールの approved=true は維持するため、公開時の既存部員には影響しない。
ALTER TABLE public.profiles ALTER COLUMN approved SET DEFAULT FALSE;

REVOKE UPDATE (approved) ON public.profiles FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.set_member_approved(target_profile_id UUID, value BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_members() THEN
    RAISE EXCEPTION 'member management permission required';
  END IF;
  UPDATE public.profiles SET approved = value WHERE id = target_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_approved(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_approved(UUID, BOOLEAN) TO authenticated;
-- 承認ゲート導入後に追加されたテーブル（threads等）も含め、全件公開SELECTを再度ゲートする。
DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual = 'true'
  LOOP
    IF policy_row.tablename = 'profiles' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.profiles USING (auth.uid() = id OR public.is_member())',
        policy_row.policyname
      );
    ELSE
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_member())',
        policy_row.policyname,
        policy_row.tablename
      );
    END IF;
  END LOOP;
END;
$$;
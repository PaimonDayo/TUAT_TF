-- ═══════════════════════════════════════════════════════════════
-- セキュリティ強化（Phase B）：閲覧を「承認済み部員」に限定する
-- ───────────────────────────────────────────────────────────────
-- 背景：認証は大学ドメインの Google ログイン。つまり authenticated には
--   「同じ大学の学生なら部外でも」誰でもなり得る（全学規模）。
--   Phase A の TO authenticated だけでは、部外の同大生に部員の実名・メール・
--   練習記録などが見えてしまう。
--
-- 方針：profiles.approved（管理者が承認）を導入し、SELECT を is_member()
--   （＝自分が承認済み）に限定する。anon + 未承認ユーザーは閲覧不可。
--   自分のプロフィール行だけは未承認でも読める（初期設定／承認待ち画面のため）。
--
-- 冪等：ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DOブロックは
--   再実行で対象0件。
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────
-- 1) approved 列
--    既存部員は承認済みでバックフィル。新規ログイン者は既定 false（承認待ち）。
-- ─────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN;
UPDATE profiles SET approved = TRUE WHERE approved IS NULL;
ALTER TABLE profiles ALTER COLUMN approved SET DEFAULT FALSE;
ALTER TABLE profiles ALTER COLUMN approved SET NOT NULL;

-- ─────────────────────────────
-- 2) 会員判定ヘルパー（RLS 無限再帰回避のため SECURITY DEFINER）
-- ─────────────────────────────
CREATE OR REPLACE FUNCTION public.is_member()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND approved);
$$;

-- ─────────────────────────────
-- 3) 自己承認の防止 ＋ 承認は「承認済み部員なら誰でも」可
--    profiles_update_own は WITH CHECK 未指定のため、放置すると本人が
--    approved=true に自己承認できてしまう。approved 列の直接 UPDATE を剥奪し、
--    SECURITY DEFINER RPC 経由のみに限定する。
--    RPC は is_member()（承認済み部員）であれば実行可＝管理者でなくても承認できる。
--    未承認ユーザーは is_member()=false なので自分や他人を承認できない（ゲート維持）。
-- ─────────────────────────────
REVOKE UPDATE (approved) ON public.profiles FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.set_member_approved(target_profile_id UUID, value BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_member() THEN
    RAISE EXCEPTION '承認済みの部員のみ操作できます';
  END IF;
  UPDATE profiles SET approved = value WHERE id = target_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_member_approved(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_approved(UUID, BOOLEAN) TO authenticated;

-- ─────────────────────────────
-- 4) SELECT ポリシーを is_member() に差し替え
--    対象は「全公開読み取り（USING (TRUE)）」のポリシーのみ。
--    既に owner 限定（auth.uid()=user_id 等）のものは触らない。
--    profiles だけは自分の行を承認前でも読める例外を入れる。
-- ─────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual = 'true'
  LOOP
    IF r.tablename = 'profiles' THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.profiles USING (auth.uid() = id OR public.is_member());',
        r.policyname);
    ELSE
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_member());',
        r.policyname, r.tablename);
    END IF;
    RAISE NOTICE 'SELECT policy gated by is_member(): %.%', r.tablename, r.policyname;
  END LOOP;
END $$;

-- PCを正本とし、通常のmirrorでクラウドの登録フックにも配る。
-- 許可リストは予備側から変更しない（書戻し対象外）。既存の他表の書戻しは変更しない。
CREATE TABLE IF NOT EXISTS public.login_email_allowlist (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND length(email) <= 254
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    AND email NOT LIKE '%@st.go.tuat.ac.jp'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);
ALTER TABLE public.login_email_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_email_allowlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.login_email_allowlist TO authenticated;
GRANT INSERT (email) ON public.login_email_allowlist TO authenticated;
GRANT ALL ON public.login_email_allowlist TO service_role;

-- 引数付きの判定はAuthフックだけに許可し、メールの存在確認APIとして公開しない。
CREATE OR REPLACE FUNCTION public.login_email_is_allowed(candidate text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(lower(btrim(candidate)) LIKE '%@st.go.tuat.ac.jp', false)
    OR EXISTS (SELECT 1 FROM public.login_email_allowlist WHERE email = lower(btrim(candidate)));
$$;
REVOKE ALL ON FUNCTION public.login_email_is_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_email_is_allowed(text) TO supabase_auth_admin, service_role;

-- auth.jwt()の署名検証済みemailだけを使う。プロフィール/user_metadataは本人確認に使わない。
CREATE OR REPLACE FUNCTION public.login_access_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND public.login_email_is_allowed(auth.jwt() ->> 'email');
$$;
REVOKE ALL ON FUNCTION public.login_access_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.login_access_allowed() TO authenticated, service_role;

DROP POLICY IF EXISTS login_allowlist_read ON public.login_email_allowlist;
CREATE POLICY login_allowlist_read ON public.login_email_allowlist FOR SELECT TO authenticated
  USING (public.login_access_allowed() AND public.can_manage_members());
DROP POLICY IF EXISTS login_allowlist_add ON public.login_email_allowlist;
CREATE POLICY login_allowlist_add ON public.login_email_allowlist FOR INSERT TO authenticated
  WITH CHECK (public.login_access_allowed() AND public.can_manage_members());
DROP POLICY IF EXISTS login_allowlist_remove ON public.login_email_allowlist;
CREATE POLICY login_allowlist_remove ON public.login_email_allowlist FOR DELETE TO authenticated
  USING (public.login_access_allowed() AND public.can_manage_members());

CREATE OR REPLACE FUNCTION public.guard_login_allowlist_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_mirror_write()
    AND coalesce((SELECT log_changes FROM public.failover_config WHERE id), false) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT503', MESSAGE = 'PC停止中はログイン許可リストを変更できません';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_login_allowlist_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_login_allowlist_write ON public.login_email_allowlist;
CREATE TRIGGER guard_login_allowlist_write BEFORE INSERT OR UPDATE OR DELETE ON public.login_email_allowlist
  FOR EACH ROW EXECUTE FUNCTION public.guard_login_allowlist_write();
-- zz_log_failover_change対象外: 予備へのユーザー書込みを上のguardで拒否し、PC→クラウドだけ写す。

CREATE OR REPLACE FUNCTION public.hook_restrict_signup_by_email_domain(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF public.login_email_is_allowed(event -> 'user' ->> 'email') THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_build_object('error', jsonb_build_object(
    'message', '大学のGoogleアカウント、または管理者が許可したGoogleアカウントでログインしてください。',
    'http_code', 403));
END;
$$;
REVOKE ALL ON FUNCTION public.hook_restrict_signup_by_email_domain(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.hook_restrict_signup_by_email_domain(jsonb) TO supabase_auth_admin;

-- RLSを迂回する既存SECURITY DEFINER RPCにも、削除済みの既存セッションから入れない。
-- service_roleの定期処理・mirrorは影響を受けない。通信失敗時のアプリcookieは消さない。
CREATE OR REPLACE FUNCTION public.check_login_access()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT public.login_access_allowed() THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', MESSAGE = 'このアカウントのログインは許可されていません';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.check_login_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_login_access() TO anon, authenticated, service_role;

-- RealtimeやStorageも既存の各操作ポリシーにANDで許可チェックを加える。
-- 元の閲覧範囲・所有者・複数ロールのOR判定はそのまま保ち、権限を広げない。
DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS require_login_access ON %I.%I', target.nspname, target.relname);
    EXECUTE format('CREATE POLICY require_login_access ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.login_access_allowed())) WITH CHECK ((SELECT public.login_access_allowed()))', target.nspname, target.relname);
  END LOOP;
END;
$$;

-- 別のpre-request設定を上書きしない。既存設定があれば適用を停止して統合を確認する。
DO $$
DECLARE previous text;
BEGIN
  SELECT split_part(setting, '=', 2) INTO previous FROM pg_roles,
    unnest(rolconfig) setting WHERE rolname = 'authenticator' AND setting LIKE 'pgrst.db_pre_request=%';
  IF coalesce(previous, '') NOT IN ('', 'public.check_login_access') THEN
    RAISE EXCEPTION 'Existing PostgREST pre-request hook must be preserved';
  END IF;
END;
$$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_login_access';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

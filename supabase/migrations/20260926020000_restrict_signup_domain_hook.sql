-- 大学のGoogleアカウント（@st.go.tuat.ac.jp）以外の新規登録を、Authの「Before User Created」フックで拒否する。
-- クラウドSupabaseのログインをPCのDBも信用するようにしたため（2026-09-26）、部外の人がクラウドで
-- アカウントを作ってPCへ「ログイン済み」として入れないようにする。アプリ側の判定（auth/callback）と二重にする。
-- フックの有効化はダッシュボード（Authentication → Hooks → Before User Created）で行う。PCとクラウドの構造を
-- そろえるため関数は両方に作るが、有効にするのはクラウドだけ。
CREATE OR REPLACE FUNCTION public.hook_restrict_signup_by_email_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
BEGIN
  IF email LIKE '%@st.go.tuat.ac.jp' THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'message', '東京農工大学のGoogleアカウント（@st.go.tuat.ac.jp）でログインしてください。',
      'http_code', 403
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.hook_restrict_signup_by_email_domain(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.hook_restrict_signup_by_email_domain(jsonb) FROM authenticated, anon, public;

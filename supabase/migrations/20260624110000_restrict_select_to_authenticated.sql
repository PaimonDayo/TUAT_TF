-- ═══════════════════════════════════════════════════════════════
-- セキュリティ修正：SELECT ポリシーを authenticated 限定にする
-- ───────────────────────────────────────────────────────────────
-- 背景：init 以来、ほぼ全テーブルの SELECT ポリシーが `USING (TRUE)` で
--   ロール無指定（＝ public ＝ anon + authenticated）だった。
--   このため、公開鍵である anon キー（クライアントJSに必ず含まれる）だけで、
--   未ログインの第三者が profiles の email（学籍番号入り大学アドレス）・実名・
--   練習記録・ノート本文などを REST API 経由で全件読めてしまっていた。
--
-- 方針：行フィルタ（USING 句）は一切変えず、ポリシーの「適用ロール」だけを
--   public → authenticated に付け替える。これで anon キー単体の読み取りが
--   ポリシー不適用となり RLS で拒否される。書き込み系（auth.uid()=... で
--   既に保護）は対象外（SELECT のみ）。
--
-- 実装：列挙漏れ（後続migrationで改名/再作成されたポリシー）を避けるため、
--   DBの現状を pg_policies から走査して付け替える。冪等（再実行で対象0件）。
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
      -- TO 無指定のポリシーは roles = {public}。public が含まれるものだけ対象。
      AND 'public' = ANY (roles)
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO authenticated;',
      r.policyname, r.schemaname, r.tablename
    );
    RAISE NOTICE 'SELECT policy restricted to authenticated: %.% / %',
      r.schemaname, r.tablename, r.policyname;
  END LOOP;
END $$;

-- 念のための二重防御：anon ロールから public スキーマの読み取り権限自体を剥がす。
-- （ポリシーを再び public に戻されても anon は GRANT レベルで弾かれる）
-- アプリは全ページ要ログインで、anon が public テーブルを読む正規フローは無い。
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;

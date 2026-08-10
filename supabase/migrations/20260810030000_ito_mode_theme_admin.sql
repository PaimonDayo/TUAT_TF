-- ═══════════════════════════════════════════════════════════════
-- ito ゲームのモード選択・テーマ・進行役の参加（オーナー確定 2026-08-10 追加分）
--   - モード: team（既存。代表者+回答者、各グループ最低2人）/
--             solo（ソロプレイ・代表のみのグループを許容。各グループ最低1人）
--   - テーマ: システム管理者がいつでも設定・変更できる（お題）
--   - 進行役の参加: システム管理者もそのゲームに参加できる（作成時に選択）
--   - 秘密数字の閲覧: システム管理者は、自分がそのラウンドの参加者でない限り
--     （＝自分が参加するゲームでない限り）、誰に何の番号が割り当てられたかを見られる。
--     自分がそのラウンドに参加している場合は、これまで通り自分の分しか見えない。
-- 冪等（IF NOT EXISTS / DROP POLICY IF EXISTS）。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.ito_games
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'team'
    CHECK (mode IN ('team', 'solo')),
  ADD COLUMN IF NOT EXISTS theme TEXT
    CHECK (theme IS NULL OR char_length(theme) <= 60),
  ADD COLUMN IF NOT EXISTS admin_participates BOOLEAN NOT NULL DEFAULT false;

-- solo モードでは代表のみのグループ（1人）を許容するため、DB 制約は下限1まで緩める。
-- team モードで最低2人であることはアプリ側（src/lib/ito-entry.ts, ito-grouping.ts）で保証する。
ALTER TABLE public.ito_games DROP CONSTRAINT IF EXISTS ito_games_max_group_size_check;
ALTER TABLE public.ito_games ADD CONSTRAINT ito_games_max_group_size_check
  CHECK (max_group_size >= 1);

-- システム管理者向けの秘密数字閲覧を追加。既存の「自分の行」「結果発表後の参加者」ポリシーに
-- 「進行役として見る（＝そのラウンドの参加者ではない）」ポリシーを OR で足す。
DROP POLICY IF EXISTS "ito_secrets_admin_visibility" ON public.ito_secrets;
CREATE POLICY "ito_secrets_admin_visibility" ON public.ito_secrets
  FOR SELECT TO authenticated USING (
    public.can_manage_system() AND NOT public.ito_is_in_round(round_id)
  );

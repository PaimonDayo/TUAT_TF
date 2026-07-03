-- 承認ゲート廃止（オーナー決定 2026-07-03）。
-- 部外の同大生が入ってくる可能性は実質なく、承認フローが不便なため撤去する。
-- approved 列と is_member() はそのまま残す（全員 TRUE になるので実質 authenticated ゲートとして機能し続ける）。
ALTER TABLE profiles ALTER COLUMN approved SET DEFAULT TRUE;
UPDATE profiles SET approved = TRUE WHERE approved = FALSE;

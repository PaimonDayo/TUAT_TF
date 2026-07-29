-- 「組み込み」はシステム管理ロールだけに限定する。
-- 旧初期ロール（管理者・メニュー担当）と全員ロールは通常どおり編集できる。
UPDATE public.roles
SET is_system = can_manage_system
WHERE is_system IS DISTINCT FROM can_manage_system;
-- 外部メール監視は所有者の判断で取りやめた（2026-09-25）。
-- 監視APIだけが呼んでいた集計関数を削除する。データは持たない。
DROP FUNCTION IF EXISTS public.operational_health();
NOTIFY pgrst, 'reload schema';

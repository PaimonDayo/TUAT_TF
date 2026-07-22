-- 運用判断: 大学ドメインのGoogleアカウント制限をアクセス境界とし、個別承認は要求しない。
ALTER TABLE public.profiles ALTER COLUMN approved SET DEFAULT TRUE;
UPDATE public.profiles SET approved = TRUE WHERE approved = FALSE;
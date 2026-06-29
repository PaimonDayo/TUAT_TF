-- お知らせの通知先をロールで絞り込み、主要画面の読み取りを高速化する。

-- 空配列は「全員」、値がある場合は該当ロールを1つ以上持つ部員だけへ通知する。
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS target_role_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_profile_roles_role_profile
  ON public.profile_roles(role_id, profile_id);

CREATE INDEX IF NOT EXISTS idx_records_social_feed
  ON public.practice_records(recorded_date DESC, created_at DESC)
  WHERE from_sheet = FALSE;

CREATE INDEX IF NOT EXISTS idx_tweets_created
  ON public.tweets(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_pending
  ON public.profiles(approved, created_at);

CREATE INDEX IF NOT EXISTS idx_notices_created
  ON public.notices(created_at DESC);

CREATE OR REPLACE FUNCTION public.handle_notice_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.notify_members THEN
    INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT DISTINCT p.id, NEW.author_id, 'notice', 'notice', NEW.id
    FROM public.profiles p
    WHERE p.status = 'active'
      AND p.approved = TRUE
      AND p.notify_notice = TRUE
      AND p.id <> NEW.author_id
      AND (
        cardinality(NEW.target_role_ids) = 0
        OR EXISTS (
          SELECT 1
          FROM public.profile_roles pr
          WHERE pr.profile_id = p.id
            AND pr.role_id = ANY(NEW.target_role_ids)
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

-- 未読バッジを即時更新できるよう notifications をRealtime公開へ追加する。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

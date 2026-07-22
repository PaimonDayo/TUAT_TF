-- スレッドに返信したとき、作成者と既参加者（返信者本人を除く）へ通知する。
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('comment', 'schedule_update', 'notice', 'sync_failure', 'thread_reply'));

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_reference_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_reference_type_check
  CHECK (reference_type IN ('record', 'tweet', 'schedule', 'notice', 'thread'));

CREATE OR REPLACE FUNCTION public.handle_thread_reply_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
  SELECT DISTINCT participant.user_id, NEW.author_id, 'thread_reply', 'thread', NEW.thread_id
  FROM (
    SELECT author_id AS user_id FROM public.threads WHERE id = NEW.thread_id
    UNION
    SELECT author_id AS user_id FROM public.thread_posts WHERE thread_id = NEW.thread_id
  ) participant
  JOIN public.profiles p ON p.id = participant.user_id
  WHERE participant.user_id <> NEW.author_id
    AND p.status = 'active'
    AND p.approved = TRUE
    AND p.notify_comment = TRUE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_thread_post_created_notify ON public.thread_posts;
CREATE TRIGGER on_thread_post_created_notify
  AFTER INSERT ON public.thread_posts
  FOR EACH ROW EXECUTE FUNCTION public.handle_thread_reply_notification();
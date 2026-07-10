-- お知らせの通知先を @All / @ロール / @部員で明示する。
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS mentioned_all BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mentioned_role_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mentioned_user_ids UUID[] NOT NULL DEFAULT '{}';

-- 既存データの意味を維持する（過去のお知らせ表示・編集用）。
UPDATE public.notices
SET mentioned_all = notify_members AND cardinality(target_role_ids) = 0,
    mentioned_role_ids = CASE WHEN notify_members THEN target_role_ids ELSE '{}'::UUID[] END
WHERE mentioned_all = FALSE
  AND cardinality(mentioned_role_ids) = 0
  AND cardinality(mentioned_user_ids) = 0;

CREATE OR REPLACE FUNCTION public.handle_notice_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.mentioned_all
     OR cardinality(NEW.mentioned_role_ids) > 0
     OR cardinality(NEW.mentioned_user_ids) > 0 THEN
    INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT DISTINCT p.id, NEW.author_id, 'notice', 'notice', NEW.id
    FROM public.profiles p
    WHERE p.status = 'active'
      AND p.approved = TRUE
      AND p.notify_notice = TRUE
      AND (
        NEW.mentioned_all
        OR p.id = ANY(NEW.mentioned_user_ids)
        OR EXISTS (
          SELECT 1 FROM public.profile_roles pr
          WHERE pr.profile_id = p.id
            AND pr.role_id = ANY(NEW.mentioned_role_ids)
        )
      )
      AND (
        p.id <> NEW.author_id
        OR EXISTS (
          SELECT 1
          FROM public.profile_roles pr
          JOIN public.roles r ON r.id = pr.role_id
          WHERE pr.profile_id = NEW.author_id
            AND r.can_manage_system = TRUE
        )
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notice_created ON public.notices;
CREATE TRIGGER on_notice_created
  AFTER INSERT ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.handle_notice_notification();

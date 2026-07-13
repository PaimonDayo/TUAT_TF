-- お知らせ通知先にブロック・学年を追加し、全条件を和集合で扱う。
ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS mentioned_blocks TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mentioned_grades TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.notices
  DROP CONSTRAINT IF EXISTS notices_mentioned_blocks_check;
ALTER TABLE public.notices
  ADD CONSTRAINT notices_mentioned_blocks_check
  CHECK (mentioned_blocks <@ ARRAY['middle_long', 'short', 'jump', 'throw']::TEXT[]);

CREATE OR REPLACE FUNCTION public.handle_notice_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.mentioned_all
     OR cardinality(NEW.mentioned_role_ids) > 0
     OR cardinality(NEW.mentioned_user_ids) > 0
     OR cardinality(NEW.mentioned_blocks) > 0
     OR cardinality(NEW.mentioned_grades) > 0 THEN
    INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
    SELECT DISTINCT p.id, NEW.author_id, 'notice', 'notice', NEW.id
    FROM public.profiles p
    WHERE p.status = 'active'
      AND p.approved = TRUE
      AND p.notify_notice = TRUE
      AND (
        NEW.mentioned_all
        OR p.id = ANY(NEW.mentioned_user_ids)
        OR p.grade = ANY(NEW.mentioned_grades)
        OR COALESCE(p.blocks, '{}'::TEXT[]) && NEW.mentioned_blocks
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
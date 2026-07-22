-- 練習記録同期が3回連続で失敗（部分失敗を含む）したとき、管理権限者へ一度だけ通知する。
ALTER TABLE public.sheet_sync_runs
  ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('comment', 'schedule_update', 'notice', 'sync_failure'));

CREATE OR REPLACE FUNCTION public.notify_sync_failure_if_needed(current_run_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_issue_count INTEGER;
  last_healthy_at TIMESTAMPTZ;
  recipient_count INTEGER := 0;
BEGIN
  -- cronの重複実行でも同じ失敗系列に複数回通知しない。
  PERFORM pg_advisory_xact_lock(hashtext('sheet-sync-failure-alert'));

  IF NOT EXISTS (
    SELECT 1 FROM public.sheet_sync_runs
    WHERE id = current_run_id
      AND (status = 'error' OR jsonb_array_length(failed_members) > 0)
  ) THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO recent_issue_count
  FROM (
    SELECT status, failed_members
    FROM public.sheet_sync_runs
    ORDER BY started_at DESC
    LIMIT 3
  ) recent
  WHERE recent.status = 'error' OR jsonb_array_length(recent.failed_members) > 0;

  IF recent_issue_count < 3 THEN
    RETURN 0;
  END IF;

  SELECT MAX(started_at) INTO last_healthy_at
  FROM public.sheet_sync_runs
  WHERE status = 'success' AND jsonb_array_length(failed_members) = 0;

  IF EXISTS (
    SELECT 1 FROM public.sheet_sync_runs
    WHERE alerted_at IS NOT NULL
      AND (last_healthy_at IS NULL OR started_at > last_healthy_at)
  ) THEN
    RETURN 0;
  END IF;

  UPDATE public.sheet_sync_runs
  SET alerted_at = NOW()
  WHERE id = current_run_id AND alerted_at IS NULL;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
  SELECT DISTINCT p.id, NULL, 'sync_failure', NULL, NULL
  FROM public.profiles p
  JOIN public.profile_roles pr ON pr.profile_id = p.id
  JOIN public.roles r ON r.id = pr.role_id
  WHERE p.status = 'active'
    AND p.approved = TRUE
    AND (r.can_manage_members = TRUE OR r.can_manage_system = TRUE);

  GET DIAGNOSTICS recipient_count = ROW_COUNT;
  RETURN recipient_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_sync_failure_if_needed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_sync_failure_if_needed(UUID) TO service_role;
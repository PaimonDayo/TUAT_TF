-- 2026-09-26: 型の付いていない NULL が SELECT DISTINCT で text と解釈され、actor_id(uuid) への INSERT が
-- 毎回失敗していた。その結果、同期結果の書き込み（status の更新）ごと弾かれ、9/9以降の実行が
-- すべて running のまま残り、失敗の通知も届いていなかった。NULL に型を付けて直す。
-- 以下は 20260730110000 と同じ内容（型の指定だけ変更）。
CREATE OR REPLACE FUNCTION public.alert_sheet_sync_issue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_healthy_cycle_at TIMESTAMPTZ;
BEGIN
  -- A running row has not produced a result yet.
  IF NEW.status = 'running' THEN
    RETURN NEW;
  END IF;

  -- A fully successful completed cycle marks recovery and re-arms alerts.
  IF NEW.status = 'success'
     AND jsonb_array_length(NEW.failed_members) = 0
     AND NEW.cycle_complete THEN
    RETURN NEW;
  END IF;

  -- Successful chunks without member failures are not incidents.
  IF NEW.status = 'success'
     AND jsonb_array_length(NEW.failed_members) = 0 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sheet-sync-failure-alert'));

  SELECT MAX(started_at)
    INTO last_healthy_cycle_at
  FROM public.sheet_sync_runs
  WHERE status = 'success'
    AND jsonb_array_length(failed_members) = 0
    AND cycle_complete = TRUE;

  -- Suppress repeats until a complete healthy cycle has occurred.
  IF EXISTS (
    SELECT 1
    FROM public.sheet_sync_runs
    WHERE alerted_at IS NOT NULL
      AND (last_healthy_cycle_at IS NULL OR started_at > last_healthy_cycle_at)
  ) THEN
    RETURN NEW;
  END IF;

  NEW.alerted_at := NOW();

  INSERT INTO public.notifications (
    user_id,
    actor_id,
    type,
    reference_type,
    reference_id
  )
  SELECT DISTINCT
    p.id,
    NULL::uuid,
    'sync_failure',
    NULL::text,
    NEW.id
  FROM public.profiles p
  JOIN public.profile_roles pr ON pr.profile_id = p.id
  JOIN public.roles r ON r.id = pr.role_id
  WHERE p.status = 'active'
    AND p.approved = TRUE
    AND (r.can_manage_members = TRUE OR r.can_manage_system = TRUE);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.alert_sheet_sync_issue() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_alert_sheet_sync_issue
  ON public.sheet_sync_runs;
CREATE TRIGGER trg_alert_sheet_sync_issue
  BEFORE UPDATE OF status, failed_members
  ON public.sheet_sync_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_sheet_sync_issue();

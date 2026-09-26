-- PC→クラウドSupabaseの写し（PCが止まったときの予備構成、2026-09-26）で書き込むとき、
-- 通知・プッシュ・スプシの予定などのトリガーの副作用を起こさないための目印。
-- 写しは service_role で、ヘッダー x-tuat-mirror: 1 を付けて PostgREST へ書き込む。
-- PCでは写しの書き込みは起きないので、PCの動きは変わらない（PCとクラウドの構造をそろえるため両方に当てる）。
CREATE OR REPLACE FUNCTION public.is_mirror_write()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('request.headers', true)::jsonb ->> 'x-tuat-mirror', '') = '1'
     AND coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.alert_sheet_sync_issue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  last_healthy_cycle_at TIMESTAMPTZ;
BEGIN
  -- PC→クラウドの写し（予備構成）による書き込みでは、通知・プッシュ・スプシ予定などの副作用を起こさない。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_notice_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写し（予備構成）による書き込みでは、通知・プッシュ・スプシ予定などの副作用を起こさない。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
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
      AND NOT (p.id = ANY(NEW.mentioned_excluded_user_ids))
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_thread_reply_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写し（予備構成）による書き込みでは、通知・プッシュ・スプシ予定などの副作用を起こさない。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_tweet_mention_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  author_id UUID;
BEGIN
  -- PC→クラウドの写し（予備構成）による書き込みでは、通知・プッシュ・スプシ予定などの副作用を起こさない。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  SELECT user_id INTO author_id FROM public.tweets WHERE id = NEW.tweet_id;
  IF NEW.profile_id <> author_id
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.profile_id AND notify_mention) THEN
    INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
    VALUES (NEW.profile_id, author_id, 'mention', 'tweet', NEW.tweet_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_sheet_row_clear()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写し（予備構成）による書き込みでは、通知・プッシュ・スプシ予定などの副作用を起こさない。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.recorded_date IS NOT DISTINCT FROM OLD.recorded_date THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = OLD.user_id AND NULLIF(BTRIM(sheet_name), '') IS NOT NULL
  ) THEN
    INSERT INTO public.sheet_pending_clears (user_id, recorded_date)
    VALUES (OLD.user_id, OLD.recorded_date)
    ON CONFLICT (user_id, recorded_date) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_notification_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  webhook_secret TEXT;
  webhook_url TEXT;
BEGIN
  -- PC→クラウドの写し（予備構成）による書き込みでは、通知・プッシュ・スプシ予定などの副作用を起こさない。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO webhook_secret
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_secret'
   ORDER BY created_at DESC LIMIT 1;

  SELECT decrypted_secret INTO webhook_url
    FROM vault.decrypted_secrets
   WHERE name = 'push_webhook_url'
   ORDER BY created_at DESC LIMIT 1;

  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING 'push_webhook_secret is not configured; push delivery skipped';
    RETURN NEW;
  END IF;

  IF webhook_url IS NULL OR webhook_url = '' THEN
    RAISE WARNING 'push_webhook_url is not configured; push delivery skipped';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'record', to_jsonb(NEW)
    )
  );
  RETURN NEW;
END;
$function$;

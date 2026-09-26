-- PC→クラウドの写し（予備構成）で書き込む表の、残りのトリガーも写しの書き込みでは動かないようにする。
-- 20260926030000 では通知・プッシュ系だけを対象にしていたが、記録フォームの版の自動作成（profiles）や
-- 更新日時の書き換えなどもクラウドで動き、写した値がPCと食い違った（2026-09-26 初回の写しで判明）。
-- 写しの書き込みは PC の値そのものなので、クラウド側のトリガーは何もしない。PCの動きは変わらない。

CREATE OR REPLACE FUNCTION public.archive_record_form_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.record_fields IS DISTINCT FROM OLD.record_fields THEN
    INSERT INTO public.record_form_config_versions (
      profile_id,
      version,
      fields,
      source,
      sheet_header_signature
    ) VALUES (
      NEW.id,
      NEW.record_fields_version,
      NEW.record_fields,
      CASE WHEN NULLIF(BTRIM(NEW.sheet_name), '') IS NULL THEN 'app' ELSE 'sheet' END,
      NEW.sheet_header_signature
    )
    ON CONFLICT (profile_id, version) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendances_check_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE starts_on date; ends_on date;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  SELECT s.schedule_date, COALESCE(s.end_date, s.schedule_date)
    INTO starts_on, ends_on
    FROM public.practice_schedules s
   WHERE s.id = NEW.schedule_id;
  IF starts_on IS NULL THEN
    RAISE EXCEPTION '予定が見つかりません';
  END IF;
  IF NEW.attend_date < starts_on OR NEW.attend_date > ends_on THEN
    RAISE EXCEPTION '出欠の日付が開催期間の外です';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.comments_delete_likes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  DELETE FROM public.likes
   WHERE target_type = 'comment' AND target_id = OLD.id;
  RETURN OLD;
END $function$;

CREATE OR REPLACE FUNCTION public.competition_events_rename()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.pb_records SET event_name = NEW.name WHERE event_name = OLD.name;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.enforce_poll_vote_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_tweet UUID;
  allows_multiple BOOLEAN;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  SELECT o.tweet_id, t.poll_multiple
    INTO target_tweet, allows_multiple
  FROM public.tweet_poll_options o
  JOIN public.tweets t ON t.id = o.tweet_id
  WHERE o.id = NEW.option_id;

  IF target_tweet IS NULL THEN
    RAISE EXCEPTION 'Poll option not found';
  END IF;

  IF NOT allows_multiple AND EXISTS (
    SELECT 1
    FROM public.tweet_poll_votes v
    JOIN public.tweet_poll_options o ON o.id = v.option_id
    WHERE o.tweet_id = target_tweet AND v.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Only one option may be selected';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_sheet_record_created_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.from_sheet = TRUE THEN
    NEW.created_at := (NEW.recorded_date::text || ' 00:00:00+09')::timestamptz;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.force_linked_profile_record_source()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NULLIF(BTRIM(NEW.sheet_name), '') IS NULL THEN
    NEW.record_source := 'app';
  ELSE
    NEW.record_source := 'sheet';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_everyone_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.is_everyone AND (NEW.can_manage_system OR NEW.can_manage_members) THEN
    RAISE EXCEPTION 'everyone role cannot grant administrative permissions';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_everyone AND NOT NEW.is_everyone THEN
    RAISE EXCEPTION 'everyone role cannot be converted';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_system_permission_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining_system_managers INTEGER;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.can_manage_system AND NOT public.can_manage_system() THEN
      RAISE EXCEPTION 'system management permission required';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.can_manage_system IS DISTINCT FROM OLD.can_manage_system THEN
    IF NOT public.can_manage_system() THEN
      RAISE EXCEPTION 'system management permission required';
    END IF;

    IF OLD.can_manage_system AND NOT NEW.can_manage_system THEN
      SELECT COUNT(DISTINCT pr.profile_id)
      INTO remaining_system_managers
      FROM public.profile_roles pr
      JOIN public.roles r ON r.id = pr.role_id
      WHERE r.can_manage_system = TRUE
        AND r.id <> OLD.id;

      IF remaining_system_managers = 0 THEN
        RAISE EXCEPTION 'cannot remove the last system manager role';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_comment_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_owner_id UUID;
  target_owner_notify_comment BOOLEAN := TRUE;
  is_active BOOLEAN := TRUE;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.target_type = 'record' THEN
    SELECT user_id INTO target_owner_id FROM practice_records WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'tweet' THEN
    SELECT user_id INTO target_owner_id FROM tweets WHERE id = NEW.target_id;
  END IF;

  IF target_owner_id IS NOT NULL AND target_owner_id != NEW.user_id THEN
    SELECT (status = 'active'), notify_comment
      INTO is_active, target_owner_notify_comment
      FROM profiles WHERE id = target_owner_id;
    IF is_active AND target_owner_notify_comment THEN
      INSERT INTO notifications (user_id, actor_id, type, reference_type, reference_id)
      VALUES (target_owner_id, NEW.user_id, 'comment', NEW.target_type, NEW.target_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.posts_delete_social_references()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE post_type text;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'tweets' THEN post_type := 'tweet';
  ELSIF TG_TABLE_NAME = 'practice_records' THEN post_type := 'record';
  ELSE RAISE EXCEPTION 'Unsupported post table';
  END IF;
  DELETE FROM public.comments WHERE target_type = post_type AND target_id = OLD.id;
  DELETE FROM public.likes WHERE target_type = post_type AND target_id = OLD.id;
  DELETE FROM public.notifications WHERE reference_type = post_type AND reference_id = OLD.id;
  RETURN OLD;
END $function$;

CREATE OR REPLACE FUNCTION public.set_comments_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.updated_at = NOW();
  ELSE
    NEW.updated_at = OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_practice_record_field_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.record_fields_snapshot IS NULL OR NEW.record_fields_version IS NULL THEN
    SELECT record_fields, record_fields_version
    INTO NEW.record_fields_snapshot, NEW.record_fields_version
    FROM public.profiles
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_sheet_linked_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF COALESCE(NEW.sheet_name, '') = '' THEN
    NEW.sheet_linked_at := NULL;
    NEW.sheet_history_imported_at := NULL;
  ELSIF COALESCE(NEW.sheet_name, '') <> COALESCE(OLD.sheet_name, '') THEN
    NEW.sheet_linked_at := (NOW() AT TIME ZONE 'Asia/Tokyo')::DATE;
    NEW.sheet_history_imported_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected_type TEXT := COALESCE(NEW.target_type, OLD.target_type);
  affected_id UUID := COALESCE(NEW.target_id, OLD.target_id);
  actual_count INTEGER;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  SELECT count(*)::integer INTO actual_count FROM public.likes WHERE target_type = affected_type AND target_id = affected_id;
  IF affected_type = 'record' THEN
    UPDATE public.practice_records SET likes_count = actual_count WHERE id = affected_id;
  ELSIF affected_type = 'tweet' THEN
    UPDATE public.tweets SET likes_count = actual_count WHERE id = affected_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_practice_record_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  has_linked_sheet BOOLEAN := FALSE;
  sync_content_changed BOOLEAN := FALSE;
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.user_id AND NULLIF(BTRIM(sheet_name), '') IS NOT NULL
  ) INTO has_linked_sheet;

  IF TG_OP = 'INSERT' THEN
    NEW.pending_sheet_push = has_linked_sheet AND NEW.synced_at IS NULL AND NOT COALESCE(NEW.from_sheet, FALSE);
    RETURN NEW;
  END IF;
  IF NEW.synced_at IS DISTINCT FROM OLD.synced_at THEN
    NEW.updated_at = COALESCE(NEW.synced_at, NOW());
    RETURN NEW;
  END IF;

  sync_content_changed = ROW(
    NEW.recorded_date, NEW.dist_low, NEW.dist_mid, NEW.dist_high, NEW.dist_speed,
    NEW.dist_actual, NEW.strides, NEW.strength_text, NEW.result_text, NEW.memo,
    NEW.menu_text, NEW.focus_text, NEW.custom
  ) IS DISTINCT FROM ROW(
    OLD.recorded_date, OLD.dist_low, OLD.dist_mid, OLD.dist_high, OLD.dist_speed,
    OLD.dist_actual, OLD.strides, OLD.strength_text, OLD.result_text, OLD.memo,
    OLD.menu_text, OLD.focus_text, OLD.custom
  );

  IF sync_content_changed THEN
    NEW.updated_at = NOW();
    NEW.pending_sheet_push = has_linked_sheet;
  ELSE
    NEW.updated_at = OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.version_record_form_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- PC→クラウドの写しでは、PCの値をそのまま再現する（クラウド側で値を変えたり副作用を起こしたりしない）。
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF NEW.record_fields IS DISTINCT FROM OLD.record_fields THEN
    NEW.record_fields_version := OLD.record_fields_version + 1;
  END IF;
  RETURN NEW;
END;
$function$;

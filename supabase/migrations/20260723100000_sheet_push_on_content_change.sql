-- 練習記録のスプレッドシート再送判定を、同期対象の内容変更だけに限定する。
-- いいね数などの補助列更新では updated_at / pending_sheet_push を変更しない。
CREATE OR REPLACE FUNCTION public.touch_practice_record_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_linked_sheet BOOLEAN := FALSE;
  sync_content_changed BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = NEW.user_id
      AND NULLIF(BTRIM(sheet_name), '') IS NOT NULL
  ) INTO has_linked_sheet;

  IF TG_OP = 'INSERT' THEN
    NEW.pending_sheet_push =
      has_linked_sheet
      AND NEW.synced_at IS NULL
      AND NOT COALESCE(NEW.from_sheet, FALSE);
    RETURN NEW;
  END IF;

  -- シート取込・GAS書込成功時は同期処理が指定した値を優先し、再送を発生させない。
  IF NEW.synced_at IS DISTINCT FROM OLD.synced_at THEN
    NEW.updated_at = COALESCE(NEW.synced_at, NOW());
    RETURN NEW;
  END IF;

  sync_content_changed = ROW(
    NEW.recorded_date,
    NEW.dist_low,
    NEW.dist_mid,
    NEW.dist_high,
    NEW.dist_speed,
    NEW.strides,
    NEW.strength_text,
    NEW.result_text,
    NEW.memo,
    NEW.menu_text,
    NEW.focus_text,
    NEW.custom
  ) IS DISTINCT FROM ROW(
    OLD.recorded_date,
    OLD.dist_low,
    OLD.dist_mid,
    OLD.dist_high,
    OLD.dist_speed,
    OLD.strides,
    OLD.strength_text,
    OLD.result_text,
    OLD.memo,
    OLD.menu_text,
    OLD.focus_text,
    OLD.custom
  );

  IF sync_content_changed THEN
    NEW.updated_at = NOW();
    NEW.pending_sheet_push = has_linked_sheet;
  ELSE
    NEW.updated_at = OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_practice_records_updated_at ON public.practice_records;
CREATE TRIGGER trg_practice_records_updated_at
  BEFORE INSERT OR UPDATE ON public.practice_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_practice_record_updated_at();

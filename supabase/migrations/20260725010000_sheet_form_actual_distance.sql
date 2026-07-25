-- スプシ見出し確認と、中長距離の実距離フォールバック。
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sheet_header_signature TEXT;

ALTER TABLE public.practice_records
  ADD COLUMN IF NOT EXISTS dist_actual NUMERIC(6,1) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.practice_records.dist_actual IS
  'シートの実際の距離。強度別合計が0の記録だけ表示・集計のフォールバックに使う';

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
$$;

DROP VIEW IF EXISTS public.weekly_ranking;
CREATE VIEW public.weekly_ranking
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.display_name,
  p.grade,
  p.blocks,
  p.avatar_url,
  COALESCE(SUM(r.dist_low), 0) AS km_low,
  COALESCE(SUM(r.dist_mid), 0) AS km_mid,
  COALESCE(SUM(r.dist_high), 0) AS km_high,
  COALESCE(SUM(r.dist_speed), 0) AS km_speed,
  COALESCE(SUM(
    CASE
      WHEN COALESCE(r.dist_low, 0) + COALESCE(r.dist_mid, 0) + COALESCE(r.dist_high, 0) + COALESCE(r.dist_speed, 0) > 0
        THEN COALESCE(r.dist_low, 0) + COALESCE(r.dist_mid, 0) + COALESCE(r.dist_high, 0) + COALESCE(r.dist_speed, 0)
      ELSE COALESCE(r.dist_actual, 0)
    END
  ), 0) AS total_km,
  ((NOW() AT TIME ZONE 'Asia/Tokyo')::date - 6) AS period_start,
  (NOW() AT TIME ZONE 'Asia/Tokyo')::date AS period_end
FROM public.profiles p
LEFT JOIN public.practice_records r
  ON r.user_id = p.id
  AND r.recorded_date >= (NOW() AT TIME ZONE 'Asia/Tokyo')::date - 6
  AND r.recorded_date <= (NOW() AT TIME ZONE 'Asia/Tokyo')::date
WHERE p.status = 'active' AND 'middle_long' = ANY(p.blocks)
GROUP BY p.id, p.display_name, p.grade, p.blocks, p.avatar_url
ORDER BY total_km DESC;

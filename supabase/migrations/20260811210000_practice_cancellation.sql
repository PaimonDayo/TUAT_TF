-- ══════════════════════════════
-- 練習の中止を記録し、お知らせとして全員（または対象ブロック）へ通知する。
--  - practice_schedules.cancelled_at / cancelled_by / cancel_reason
--  - set_schedule_cancelled(): 開催判断権限者だけが中止・取り消しできる。
--    お知らせを1件作成し、既存の handle_notice_notification トリガー経由で
--    通知（通知センター・プッシュ）に載せる。お知らせ作成権限は不要。
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.practice_schedules ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.practice_schedules ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.practice_schedules ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE OR REPLACE FUNCTION public.set_schedule_cancelled(
  target_schedule_id UUID,
  cancel BOOLEAN,
  reason TEXT DEFAULT NULL
)
RETURNS public.practice_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized TEXT := NULLIF(TRIM(reason), '');
  result public.practice_schedules;
  blocks TEXT[];
  type_label TEXT;
  notice_title TEXT;
  notice_body TEXT;
BEGIN
  IF NOT public.can_decide_practice() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE public.practice_schedules
  SET cancelled_at = CASE WHEN cancel THEN NOW() ELSE NULL END,
      cancelled_by = CASE WHEN cancel THEN auth.uid() ELSE NULL END,
      cancel_reason = CASE WHEN cancel THEN normalized ELSE NULL END
  WHERE id = target_schedule_id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'schedule not found';
  END IF;

  -- 通知先は予定の対象ブロック。全体向けの予定なら全員へ。
  -- （mentioned_blocks は middle_long/short/jump/throw しか許可されていないため manager は除く）
  blocks := COALESCE(
    ARRAY(
      SELECT b FROM unnest(result.target_blocks) AS b
      WHERE b IN ('middle_long', 'short', 'jump', 'throw')
    ),
    '{}'::TEXT[]
  );

  type_label := CASE result.schedule_type
    WHEN 'practice' THEN '練習'
    WHEN 'time_trial' THEN '記録会'
    ELSE '大会・行事'
  END;

  IF cancel THEN
    notice_title := to_char(result.schedule_date, 'FMMM"月"FMDD"日"') || 'の' || type_label || 'は中止です';
    notice_body := COALESCE(normalized, '中止になりました。');
  ELSE
    notice_title := to_char(result.schedule_date, 'FMMM"月"FMDD"日"') || 'の' || type_label || 'は中止を取り消しました';
    notice_body := '予定どおり実施します。';
  END IF;

  INSERT INTO public.notices (
    author_id, category, title, content,
    notify_members, mentioned_all, mentioned_blocks
  )
  VALUES (
    auth.uid(), 'info', notice_title, notice_body,
    TRUE, cardinality(blocks) = 0, blocks
  );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_schedule_cancelled(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_schedule_cancelled(UUID, BOOLEAN, TEXT) TO authenticated;

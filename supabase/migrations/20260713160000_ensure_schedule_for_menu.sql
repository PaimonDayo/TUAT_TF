-- 月間メニュー入力で、予定登録より先にメニューを作れるようにする。
-- 運用上「同日1練習」のため、日付ごとに既存練習予定を再利用し、無ければ最小予定を作る。
CREATE OR REPLACE FUNCTION public.ensure_practice_schedule_for_menu(target_date DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_id UUID;
BEGIN
  IF NOT public.can_create_menu() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(target_date::TEXT));

  SELECT id INTO schedule_id
  FROM public.practice_schedules
  WHERE schedule_date = target_date
    AND schedule_type = 'practice'
  ORDER BY created_at
  LIMIT 1;

  IF schedule_id IS NULL THEN
    INSERT INTO public.practice_schedules (
      schedule_date,
      schedule_type,
      target_blocks,
      created_by
    ) VALUES (
      target_date,
      'practice',
      '{}',
      auth.uid()
    )
    RETURNING id INTO schedule_id;
  END IF;

  RETURN schedule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_practice_schedule_for_menu(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_practice_schedule_for_menu(DATE) TO authenticated;

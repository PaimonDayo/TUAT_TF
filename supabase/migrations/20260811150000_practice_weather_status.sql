-- ═══════════════════════════════════════════════════════════════
-- 雨天時など「開催するか話し合い中です」を伝える対応状況欄を予定に追加。
--  - roles.can_decide_practice: 練習の開催を決定する権限（新規）
--    デフォルトでシステム管理ロールに付与する。
--  - practice_schedules.weather_note ほか: 対応状況の自由記述＋更新者・時刻
--  - set_schedule_weather_note(): 権限者だけがこの欄だけを更新できるRPC
--    （schedules_update の全体更新権限を広げずに済むよう分離）
-- ═══════════════════════════════════════════════════════════════

-- ── 1. 権限列 ─────────────────────────────
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS can_decide_practice BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.roles
SET can_decide_practice = TRUE
WHERE can_manage_system = TRUE;

CREATE OR REPLACE FUNCTION public.can_decide_practice()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE pr.profile_id = auth.uid() AND r.can_decide_practice
  );
$$;

-- ── 2. 予定への対応状況欄 ───────────────────
ALTER TABLE public.practice_schedules ADD COLUMN IF NOT EXISTS weather_note TEXT;
ALTER TABLE public.practice_schedules ADD COLUMN IF NOT EXISTS weather_note_updated_at TIMESTAMPTZ;
ALTER TABLE public.practice_schedules ADD COLUMN IF NOT EXISTS weather_note_updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 3. 更新用RPC（この欄だけを更新。practice_schedulesの他列には触れない） ──
CREATE OR REPLACE FUNCTION public.set_schedule_weather_note(
  target_schedule_id UUID,
  new_note TEXT
)
RETURNS public.practice_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized TEXT := NULLIF(TRIM(new_note), '');
  result public.practice_schedules;
BEGIN
  IF NOT public.can_decide_practice() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE public.practice_schedules
  SET weather_note = normalized,
      weather_note_updated_at = CASE WHEN normalized IS NULL THEN NULL ELSE NOW() END,
      weather_note_updated_by = CASE WHEN normalized IS NULL THEN NULL ELSE auth.uid() END
  WHERE id = target_schedule_id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'schedule not found';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_schedule_weather_note(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_schedule_weather_note(UUID, TEXT) TO authenticated;

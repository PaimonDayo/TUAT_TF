-- ═══════════════════════════════════════════════════════════════
-- 変更:
--  1) 予定の種別に「記録会(time_trial)」を追加（練習/大会/行事/記録会）
--  2) 予定にエントリー期間・地図URLを追加
--  3) 出欠(attendances)テーブル
--  4) お知らせのホーム表示(pin_home)＋各自の既読/非表示(notice_dismissals)
-- ═══════════════════════════════════════════════════════════════

-- ── 1) 種別に time_trial を追加 ─────────────
ALTER TABLE practice_schedules DROP CONSTRAINT IF EXISTS practice_schedules_schedule_type_check;
ALTER TABLE practice_schedules ADD CONSTRAINT practice_schedules_schedule_type_check
  CHECK (schedule_type IN ('practice', 'meet', 'event', 'time_trial'));

-- ── 2) エントリー期間・地図URL ───────────────
ALTER TABLE practice_schedules ADD COLUMN IF NOT EXISTS entry_start DATE;
ALTER TABLE practice_schedules ADD COLUMN IF NOT EXISTS entry_end DATE;
ALTER TABLE practice_schedules ADD COLUMN IF NOT EXISTS venue_url TEXT;

-- ── 3) 出欠 ─────────────────────────────────
CREATE TABLE IF NOT EXISTS attendances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES practice_schedules(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_attendances_schedule ON attendances(schedule_id);

ALTER TABLE attendances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendances_select" ON attendances FOR SELECT USING (TRUE);
CREATE POLICY "attendances_insert" ON attendances FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "attendances_update" ON attendances FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "attendances_delete" ON attendances FOR DELETE USING (auth.uid() = user_id);

-- ── 4) お知らせ: ホーム表示 + 各自の非表示 ──────
ALTER TABLE notices ADD COLUMN IF NOT EXISTS pin_home BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS notice_dismissals (
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notice_id  UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, notice_id)
);

ALTER TABLE notice_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dismissals_select" ON notice_dismissals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "dismissals_insert" ON notice_dismissals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dismissals_delete" ON notice_dismissals FOR DELETE USING (auth.uid() = user_id);

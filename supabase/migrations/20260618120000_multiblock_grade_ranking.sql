-- ═══════════════════════════════════════════════════════════════
-- 変更:
--  1) ブロックを複数選択可に: profiles.block(TEXT) → profiles.blocks(TEXT[])
--  2) 学年を院生対応に: profiles.grade(INT 1-4) → grade(TEXT: '1'..'4','M1','M2','D1'..'D3')
--  3) ランキングビューを「直近7日 + 強度別集計」に作り直し
-- ═══════════════════════════════════════════════════════════════

-- 先に依存するビューを削除（block/grade 列に依存しているため）
DROP VIEW IF EXISTS weekly_ranking;

-- ── 1) 複数ブロック ──────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS blocks TEXT[] NOT NULL DEFAULT '{}';
UPDATE profiles SET blocks = ARRAY[block] WHERE block IS NOT NULL AND blocks = '{}';
ALTER TABLE profiles DROP COLUMN IF EXISTS block;

-- ── 2) 学年を TEXT に ────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_grade_check;
ALTER TABLE profiles ALTER COLUMN grade TYPE TEXT USING (grade::text);
ALTER TABLE profiles ADD CONSTRAINT profiles_grade_check
  CHECK (grade IS NULL OR grade IN ('1','2','3','4','M1','M2','D1','D2','D3'));

-- ── 3) ランキングビュー（直近7日 / 強度別 / 中長距離を含む人） ──
CREATE VIEW weekly_ranking
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.display_name,
  p.grade,
  p.blocks,
  p.avatar_url,
  COALESCE(SUM(r.dist_low),  0) AS km_low,
  COALESCE(SUM(r.dist_mid),  0) AS km_mid,
  COALESCE(SUM(r.dist_high), 0) AS km_high,
  COALESCE(SUM(r.dist_speed),0) AS km_speed,
  COALESCE(SUM(r.dist_low + r.dist_mid + r.dist_high + r.dist_speed), 0) AS total_km,
  ((NOW() AT TIME ZONE 'Asia/Tokyo')::date - 6) AS period_start,
  (NOW() AT TIME ZONE 'Asia/Tokyo')::date AS period_end
FROM profiles p
LEFT JOIN practice_records r
  ON r.user_id = p.id
  AND r.recorded_date >= (NOW() AT TIME ZONE 'Asia/Tokyo')::date - 6
  AND r.recorded_date <= (NOW() AT TIME ZONE 'Asia/Tokyo')::date
WHERE p.status = 'active'
  AND 'middle_long' = ANY(p.blocks)
GROUP BY p.id, p.display_name, p.grade, p.blocks, p.avatar_url
ORDER BY total_km DESC;

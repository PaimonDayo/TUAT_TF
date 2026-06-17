-- ═══════════════════════════════════════════════════════════════
-- 陸上部ログ — データベーススキーマ
-- Supabase の SQL Editor に貼り付けて、上から順に実行してください。
-- （設計書のSQLに加え、RLS無限再帰の回避・初回プロフィール自動作成・
--   JST対応・いいね数の自動同期 を組み込んだ修正版です）
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────
-- 1. PROFILES（部員情報）
-- ─────────────────────────────
CREATE TABLE profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT,
  block        TEXT CHECK (block IN ('middle_long', 'short', 'jump', 'throw')),
  grade        INT CHECK (grade BETWEEN 1 AND 4),
  role         TEXT NOT NULL DEFAULT 'member'
               CHECK (role IN ('admin', 'menu_staff', 'member')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'graduated')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────
-- 2. PRACTICE_RECORDS（練習記録）
-- ─────────────────────────────
CREATE TABLE practice_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recorded_date DATE NOT NULL,
  dist_low      NUMERIC(5,1) DEFAULT 0,
  dist_mid      NUMERIC(5,1) DEFAULT 0,
  dist_high     NUMERIC(5,1) DEFAULT 0,
  dist_speed    NUMERIC(5,1) DEFAULT 0,
  strides       INT DEFAULT 0,
  result_text   TEXT,
  strength_text TEXT,
  memo          TEXT,
  condition     TEXT CHECK (condition IN ('great', 'normal', 'bad')),
  likes_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_records_user ON practice_records(user_id);
CREATE INDEX idx_records_date ON practice_records(recorded_date DESC);

-- ─────────────────────────────
-- 3. TWEETS（つぶやき）
-- ─────────────────────────────
CREATE TABLE tweets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content     TEXT NOT NULL CHECK (char_length(content) <= 200),
  likes_count INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────
-- 4. LIKES（いいね）
-- ─────────────────────────────
CREATE TABLE likes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('record', 'tweet')),
  target_id   UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX idx_likes_target ON likes(target_type, target_id);

-- ─────────────────────────────
-- 5. COMMENTS（コメント）
-- ─────────────────────────────
CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('record', 'tweet')),
  target_id   UUID NOT NULL,
  content     TEXT NOT NULL CHECK (char_length(content) <= 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_comments_target ON comments(target_type, target_id);

-- ─────────────────────────────
-- 6. PRACTICE_SCHEDULES（練習予定）
-- ─────────────────────────────
CREATE TABLE practice_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date DATE NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('practice', 'meet', 'event')),
  meeting_time  TIME,
  location      TEXT,
  venue_name    TEXT,
  venue_access  TEXT,
  venue_fee     TEXT,
  title         TEXT,
  end_date      DATE,
  note          TEXT,
  created_by    UUID NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_schedules_date ON practice_schedules(schedule_date);

-- ─────────────────────────────
-- 7. PRACTICE_MENUS（練習メニュー）
-- ─────────────────────────────
CREATE TABLE practice_menus (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES practice_schedules(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES profiles(id),
  group_name  TEXT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────
-- 8. NOTICES（お知らせ）
-- ─────────────────────────────
CREATE TABLE notices (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES profiles(id),
  category  TEXT NOT NULL CHECK (category IN ('fee', 'entry', 'info', 'rule')),
  title     TEXT NOT NULL,
  content   TEXT NOT NULL,
  deadline  DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────
-- 9. PB_RECORDS（自己ベスト）
-- ─────────────────────────────
CREATE TABLE pb_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_name  TEXT NOT NULL,
  record      TEXT NOT NULL,
  meet_name   TEXT,
  recorded_on DATE,
  is_pb       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- ヘルパー関数（RLS の無限再帰を避けるため SECURITY DEFINER で role を取得）
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'menu_staff')
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- 初回ログイン時に profiles 行を自動作成するトリガー
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════
-- いいね数を自動同期するトリガー（likes ⇄ practice_records/tweets）
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sync_likes_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  tgt_type TEXT;
  tgt_id   UUID;
  delta    INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    tgt_type := NEW.target_type; tgt_id := NEW.target_id; delta := 1;
  ELSE
    tgt_type := OLD.target_type; tgt_id := OLD.target_id; delta := -1;
  END IF;

  IF tgt_type = 'record' THEN
    UPDATE practice_records SET likes_count = GREATEST(0, likes_count + delta) WHERE id = tgt_id;
  ELSIF tgt_type = 'tweet' THEN
    UPDATE tweets SET likes_count = GREATEST(0, likes_count + delta) WHERE id = tgt_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_likes_count ON likes;
CREATE TRIGGER trg_likes_count
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_likes_count();

-- ═══════════════════════════════════════════════════════════════
-- ビュー：週間走行距離ランキング（中長距離 / JST 基準）
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW weekly_ranking
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.display_name,
  p.grade,
  p.block,
  p.avatar_url,
  COALESCE(SUM(r.dist_low + r.dist_mid + r.dist_high + r.dist_speed), 0) AS total_km,
  DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Tokyo'))::date AS week_start
FROM profiles p
LEFT JOIN practice_records r
  ON r.user_id = p.id
  AND r.recorded_date >= DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Tokyo'))::date
  AND r.recorded_date <  DATE_TRUNC('week', (NOW() AT TIME ZONE 'Asia/Tokyo'))::date + INTERVAL '7 days'
WHERE p.status = 'active'
  AND p.block = 'middle_long'
GROUP BY p.id, p.display_name, p.grade, p.block, p.avatar_url
ORDER BY total_km DESC;

-- ═══════════════════════════════════════════════════════════════
-- RLS 有効化
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tweets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_menus     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pb_records         ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE USING (public.is_admin());

-- practice_records
CREATE POLICY "records_select" ON practice_records FOR SELECT USING (TRUE);
CREATE POLICY "records_insert" ON practice_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "records_update" ON practice_records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "records_delete" ON practice_records FOR DELETE USING (auth.uid() = user_id);

-- tweets
CREATE POLICY "tweets_select" ON tweets FOR SELECT USING (TRUE);
CREATE POLICY "tweets_insert" ON tweets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tweets_delete" ON tweets FOR DELETE USING (auth.uid() = user_id);

-- likes
CREATE POLICY "likes_select" ON likes FOR SELECT USING (TRUE);
CREATE POLICY "likes_insert" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete" ON likes FOR DELETE USING (auth.uid() = user_id);

-- comments
CREATE POLICY "comments_select" ON comments FOR SELECT USING (TRUE);
CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete" ON comments FOR DELETE USING (auth.uid() = user_id);

-- practice_schedules
CREATE POLICY "schedules_select" ON practice_schedules FOR SELECT USING (TRUE);
CREATE POLICY "schedules_insert" ON practice_schedules FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "schedules_update" ON practice_schedules FOR UPDATE USING (public.is_staff());
CREATE POLICY "schedules_delete" ON practice_schedules FOR DELETE USING (public.is_staff());

-- practice_menus
CREATE POLICY "menus_select" ON practice_menus FOR SELECT USING (TRUE);
CREATE POLICY "menus_insert" ON practice_menus FOR INSERT
  WITH CHECK (auth.uid() = author_id AND public.is_staff());
CREATE POLICY "menus_update" ON practice_menus FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "menus_delete" ON practice_menus FOR DELETE USING (auth.uid() = author_id);

-- notices
CREATE POLICY "notices_select" ON notices FOR SELECT USING (TRUE);
CREATE POLICY "notices_insert" ON notices FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "notices_update" ON notices FOR UPDATE USING (public.is_admin());
CREATE POLICY "notices_delete" ON notices FOR DELETE USING (public.is_admin());

-- pb_records
CREATE POLICY "pb_select" ON pb_records FOR SELECT USING (TRUE);
CREATE POLICY "pb_insert" ON pb_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pb_update" ON pb_records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "pb_delete" ON pb_records FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- 初回管理者の設定（あなたのメールアドレスに変更して実行）
-- ═══════════════════════════════════════════════════════════════
-- UPDATE profiles SET role = 'admin' WHERE email = 'your-email@st.your-univ.ac.jp';

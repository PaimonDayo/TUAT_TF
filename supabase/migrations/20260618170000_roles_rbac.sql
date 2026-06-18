-- ═══════════════════════════════════════════════════════════════
-- ロール（役職）機能：カスタムロール ＋ 権限トグル ＋ 複数ロール
--   - roles: 役職定義（名前 + 権限フラグ）
--   - profile_roles: 部員 ⇔ ロール の多対多（1人に複数ロール可）
--   - 権限は所属ロールの論理和（OR）で判定
-- 既存の単一 role（admin / menu_staff / member）からデータ移行する。
--
-- ※ 何度実行しても安全（再実行可）なように IF NOT EXISTS / DROP POLICY IF EXISTS
--   などで冪等にしてある。
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────
-- 1. ROLES（ロール定義）
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  can_manage_members  BOOLEAN NOT NULL DEFAULT FALSE,  -- 部員・ロール管理（管理者相当）
  can_create_schedule BOOLEAN NOT NULL DEFAULT FALSE,  -- 練習予定の作成
  can_create_menu     BOOLEAN NOT NULL DEFAULT FALSE,  -- 練習メニューの作成
  can_create_notice   BOOLEAN NOT NULL DEFAULT FALSE,  -- お知らせの作成
  is_system           BOOLEAN NOT NULL DEFAULT FALSE,  -- 組込ロール（削除不可）
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────
-- 2. PROFILE_ROLES（部員⇔ロール）
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS profile_roles (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_roles_profile ON profile_roles(profile_id);

-- ─────────────────────────────
-- 3. 組込ロールを投入（無いときだけ）
-- ─────────────────────────────
INSERT INTO roles (name, can_manage_members, can_create_schedule, can_create_menu, can_create_notice, is_system)
SELECT '管理者', TRUE, TRUE, TRUE, TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = '管理者' AND is_system);

INSERT INTO roles (name, can_manage_members, can_create_schedule, can_create_menu, can_create_notice, is_system)
SELECT 'メニュー担当', FALSE, TRUE, TRUE, FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'メニュー担当' AND is_system);

-- ─────────────────────────────
-- 4. 権限判定ヘルパー（RLS 無限再帰を避けるため SECURITY DEFINER）
--    所属ロールのいずれかが該当権限を持てば TRUE。
-- ─────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_members()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr JOIN roles r ON r.id = pr.role_id
    WHERE pr.profile_id = auth.uid() AND r.can_manage_members
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_schedule()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr JOIN roles r ON r.id = pr.role_id
    WHERE pr.profile_id = auth.uid() AND r.can_create_schedule
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_menu()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr JOIN roles r ON r.id = pr.role_id
    WHERE pr.profile_id = auth.uid() AND r.can_create_menu
  );
$$;

CREATE OR REPLACE FUNCTION public.can_create_notice()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_roles pr JOIN roles r ON r.id = pr.role_id
    WHERE pr.profile_id = auth.uid() AND r.can_create_notice
  );
$$;

-- 旧 is_admin() は「部員・ロール管理権限」を意味するよう再定義（既存ポリシー互換）。
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.can_manage_members();
$$;

-- ─────────────────────────────
-- 5. 既存データの移行（単一 role → profile_roles）
-- ─────────────────────────────
INSERT INTO profile_roles (profile_id, role_id)
SELECT p.id, r.id FROM profiles p CROSS JOIN roles r
WHERE p.role = 'admin' AND r.name = '管理者' AND r.is_system
ON CONFLICT DO NOTHING;

INSERT INTO profile_roles (profile_id, role_id)
SELECT p.id, r.id FROM profiles p CROSS JOIN roles r
WHERE p.role = 'menu_staff' AND r.name = 'メニュー担当' AND r.is_system
ON CONFLICT DO NOTHING;

-- ─────────────────────────────
-- 6. RLS（roles / profile_roles）
-- ─────────────────────────────
ALTER TABLE roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select" ON roles;
DROP POLICY IF EXISTS "roles_insert" ON roles;
DROP POLICY IF EXISTS "roles_update" ON roles;
DROP POLICY IF EXISTS "roles_delete" ON roles;
CREATE POLICY "roles_select" ON roles FOR SELECT USING (TRUE);
CREATE POLICY "roles_insert" ON roles FOR INSERT WITH CHECK (public.can_manage_members());
CREATE POLICY "roles_update" ON roles FOR UPDATE USING (public.can_manage_members());
-- 組込ロールは削除不可
CREATE POLICY "roles_delete" ON roles FOR DELETE USING (public.can_manage_members() AND NOT is_system);

DROP POLICY IF EXISTS "profile_roles_select" ON profile_roles;
DROP POLICY IF EXISTS "profile_roles_insert" ON profile_roles;
DROP POLICY IF EXISTS "profile_roles_delete" ON profile_roles;
CREATE POLICY "profile_roles_select" ON profile_roles FOR SELECT USING (TRUE);
CREATE POLICY "profile_roles_insert" ON profile_roles FOR INSERT WITH CHECK (public.can_manage_members());
CREATE POLICY "profile_roles_delete" ON profile_roles FOR DELETE USING (public.can_manage_members());

-- ─────────────────────────────
-- 7. 既存ポリシーを新しい権限関数に置き換え
-- ─────────────────────────────
-- 練習予定
DROP POLICY IF EXISTS "schedules_insert" ON practice_schedules;
DROP POLICY IF EXISTS "schedules_update" ON practice_schedules;
DROP POLICY IF EXISTS "schedules_delete" ON practice_schedules;
CREATE POLICY "schedules_insert" ON practice_schedules FOR INSERT WITH CHECK (public.can_create_schedule());
CREATE POLICY "schedules_update" ON practice_schedules FOR UPDATE USING (public.can_create_schedule());
CREATE POLICY "schedules_delete" ON practice_schedules FOR DELETE USING (public.can_create_schedule());

-- 練習メニュー（作成は本人 author かつ作成権限あり）
DROP POLICY IF EXISTS "menus_insert" ON practice_menus;
CREATE POLICY "menus_insert" ON practice_menus FOR INSERT
  WITH CHECK (auth.uid() = author_id AND public.can_create_menu());

-- お知らせ
DROP POLICY IF EXISTS "notices_insert" ON notices;
DROP POLICY IF EXISTS "notices_update" ON notices;
DROP POLICY IF EXISTS "notices_delete" ON notices;
CREATE POLICY "notices_insert" ON notices FOR INSERT WITH CHECK (public.can_create_notice());
CREATE POLICY "notices_update" ON notices FOR UPDATE USING (public.can_create_notice());
CREATE POLICY "notices_delete" ON notices FOR DELETE USING (public.can_create_notice());

-- ═══════════════════════════════════════════════════════════════
-- 8. 自分を管理者にする（メールアドレスを自分のログイン用に変えて実行）
--    ※ 既に profiles.role='admin' だった人は 5. で自動付与済み。
-- ═══════════════════════════════════════════════════════════════
INSERT INTO profile_roles (profile_id, role_id)
SELECT p.id, r.id FROM profiles p CROSS JOIN roles r
WHERE p.email = 's253013u@st.go.tuat.ac.jp' AND r.name = '管理者' AND r.is_system
ON CONFLICT DO NOTHING;

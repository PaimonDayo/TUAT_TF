-- ═══════════════════════════════════════════════════════════════
-- ito ゲーム（合宿などで50人規模を想定）
--   詳細な設計意図は docs/ITO-PLAN.md を参照。
--   - 進行役は can_manage_system() 保持者。ゲームには参加しない。
--   - ゲーム状態（ito_games.status）とラウンド状態（ito_rounds.phase）を分離。
--   - 秘密数字（ito_secrets）は結果発表まで本人以外に渡さない。Realtime にも載せない。
--   - 得点は ito_point_events の履歴が正。累計は SUM で出し、再採点できる。
-- 冪等（IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE）。
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────
-- 1. テーブル
-- ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.ito_games (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  target_role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
  group_count    INTEGER NOT NULL CHECK (group_count >= 2),
  max_group_size INTEGER NOT NULL CHECK (max_group_size >= 2),
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'entry', 'active', 'finished')),
  created_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 招待の履歴。1行＝1回の招待。過去の招待行は書き換えない（再招待は新しい行）。
CREATE TABLE IF NOT EXISTS public.ito_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      UUID NOT NULL REFERENCES public.ito_games(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- このラウンドから参加してもらう想定（初回招待は 1）
  round_no     INTEGER NOT NULL CHECK (round_no >= 1),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'joined', 'declined')),
  invited_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE (game_id, profile_id, round_no)
);

-- 現在の参加プール（可変）。履歴は ito_invitations と ito_group_members が持つ。
CREATE TABLE IF NOT EXISTS public.ito_participants (
  game_id      UUID NOT NULL REFERENCES public.ito_games(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'excluded')),
  joined_round INTEGER NOT NULL CHECK (joined_round >= 1),
  left_round   INTEGER,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, profile_id)
);

CREATE TABLE IF NOT EXISTS public.ito_rounds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES public.ito_games(id) ON DELETE CASCADE,
  round_no   INTEGER NOT NULL CHECK (round_no >= 1),
  phase      TEXT NOT NULL DEFAULT 'grouping' CHECK (phase IN (
               'grouping', 'leader_select', 'numbers', 'leader_answers',
               'ordering', 'locked', 'revealed', 'result', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  ended_at   TIMESTAMPTZ,
  UNIQUE (game_id, round_no)
);

-- 代表者チームは is_leader_team=true の1行。所属行は持たず is_leader から導出する。
CREATE TABLE IF NOT EXISTS public.ito_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  is_leader_team BOOLEAN NOT NULL DEFAULT false,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ito_groups_leader_team_uniq
  ON public.ito_groups(round_id) WHERE is_leader_team;

CREATE TABLE IF NOT EXISTS public.ito_group_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES public.ito_groups(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_leader  BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (round_id, profile_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ito_group_members_one_leader
  ON public.ito_group_members(group_id) WHERE is_leader;

-- 秘密数字。Realtime publication には入れない。
CREATE TABLE IF NOT EXISTS public.ito_secrets (
  round_id     UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  profile_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL CHECK (number BETWEEN 1 AND 100),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (round_id, profile_id),
  UNIQUE (round_id, number)
);

-- 代表者の自由回答。管理者が口頭発言を聞いて手入力する。
CREATE TABLE IF NOT EXISTS public.ito_leader_answers (
  round_id   UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  answer     TEXT NOT NULL CHECK (char_length(answer) <= 100),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, profile_id)
);

-- グループ共有の並び順。round_id は Realtime の filter 用に非正規化して持つ。
CREATE TABLE IF NOT EXISTS public.ito_group_orders (
  group_id   UUID PRIMARY KEY REFERENCES public.ito_groups(id) ON DELETE CASCADE,
  round_id   UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  order_ids  UUID[] NOT NULL DEFAULT '{}',
  revision   INTEGER NOT NULL DEFAULT 0,
  submitted  BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ito_round_scores (
  group_id      UUID PRIMARY KEY REFERENCES public.ito_groups(id) ON DELETE CASCADE,
  round_id      UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  correct_count INTEGER NOT NULL,
  points        INTEGER NOT NULL,
  is_perfect    BOOLEAN NOT NULL DEFAULT false,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 個人得点はこの履歴が正。累計は SUM で算出する（total 列は持たない）。
CREATE TABLE IF NOT EXISTS public.ito_point_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES public.ito_games(id) ON DELETE CASCADE,
  round_id   UUID NOT NULL REFERENCES public.ito_rounds(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points     INTEGER NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('group', 'leader_team')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, profile_id)
);

CREATE INDEX IF NOT EXISTS ito_invitations_profile_idx
  ON public.ito_invitations(profile_id, status);
CREATE INDEX IF NOT EXISTS ito_rounds_game_idx ON public.ito_rounds(game_id, round_no);
CREATE INDEX IF NOT EXISTS ito_groups_round_idx ON public.ito_groups(round_id, sort_order);
CREATE INDEX IF NOT EXISTS ito_group_members_group_idx ON public.ito_group_members(group_id);
CREATE INDEX IF NOT EXISTS ito_group_orders_round_idx ON public.ito_group_orders(round_id);
CREATE INDEX IF NOT EXISTS ito_round_scores_round_idx ON public.ito_round_scores(round_id);
CREATE INDEX IF NOT EXISTS ito_point_events_game_idx
  ON public.ito_point_events(game_id, profile_id);

-- ─────────────────────────────
-- 2. ヘルパー（RLS の再帰を避けるため SECURITY DEFINER）
-- ─────────────────────────────
CREATE OR REPLACE FUNCTION public.ito_round_phase(target_round_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT phase FROM public.ito_rounds WHERE id = target_round_id;
$$;

CREATE OR REPLACE FUNCTION public.ito_group_round(target_group_id UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT round_id FROM public.ito_groups WHERE id = target_group_id;
$$;

/** そのラウンドの代表者か（代表者チームの編集権はここで判定する） */
CREATE OR REPLACE FUNCTION public.ito_is_leader_in_round(target_round_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ito_group_members m
    WHERE m.round_id = target_round_id AND m.profile_id = auth.uid() AND m.is_leader
  );
$$;

/** そのラウンドに参加しているか（結果閲覧の範囲判定に使う） */
CREATE OR REPLACE FUNCTION public.ito_is_in_round(target_round_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ito_group_members m
    WHERE m.round_id = target_round_id AND m.profile_id = auth.uid()
  );
$$;

/** そのグループの並び順を読めるか（自分の班／代表者チームなら代表者） */
CREATE OR REPLACE FUNCTION public.ito_can_read_group(target_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    CASE
      WHEN public.can_manage_system() THEN TRUE
      -- 予想公開以降は参加者全員が全グループの回答を見られる
      WHEN public.ito_round_phase(public.ito_group_round(target_group_id))
           IN ('revealed', 'result', 'finished')
        THEN public.ito_is_in_round(public.ito_group_round(target_group_id))
      WHEN EXISTS (SELECT 1 FROM public.ito_groups g
                   WHERE g.id = target_group_id AND g.is_leader_team)
        THEN public.ito_is_leader_in_round(public.ito_group_round(target_group_id))
      ELSE EXISTS (
        SELECT 1 FROM public.ito_group_members m
        WHERE m.group_id = target_group_id AND m.profile_id = auth.uid()
      )
    END;
$$;

/** そのグループの並び順を編集できるか（回答受付中のみ・代表者は自班の編集不可） */
CREATE OR REPLACE FUNCTION public.ito_can_edit_group(target_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    public.ito_round_phase(public.ito_group_round(target_group_id)) = 'ordering'
    AND CASE
      WHEN EXISTS (SELECT 1 FROM public.ito_groups g
                   WHERE g.id = target_group_id AND g.is_leader_team)
        THEN public.ito_is_leader_in_round(public.ito_group_round(target_group_id))
      ELSE EXISTS (
        SELECT 1 FROM public.ito_group_members m
        WHERE m.group_id = target_group_id
          AND m.profile_id = auth.uid()
          AND NOT m.is_leader
      )
    END;
$$;

-- ─────────────────────────────
-- 3. RLS
--    書き込みはすべて SECURITY DEFINER RPC か管理者に限定する。
-- ─────────────────────────────
ALTER TABLE public.ito_games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_invitations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_secrets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_leader_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_group_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_round_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ito_point_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ito_games_select" ON public.ito_games;
DROP POLICY IF EXISTS "ito_games_write" ON public.ito_games;
CREATE POLICY "ito_games_select" ON public.ito_games
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ito_games_write" ON public.ito_games
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_invitations_select" ON public.ito_invitations;
DROP POLICY IF EXISTS "ito_invitations_write" ON public.ito_invitations;
CREATE POLICY "ito_invitations_select" ON public.ito_invitations
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.can_manage_system());
-- 応答は ito_respond_invitation() 経由のみ。直接更新はさせない。
CREATE POLICY "ito_invitations_write" ON public.ito_invitations
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_participants_select" ON public.ito_participants;
DROP POLICY IF EXISTS "ito_participants_write" ON public.ito_participants;
CREATE POLICY "ito_participants_select" ON public.ito_participants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ito_participants_write" ON public.ito_participants
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_rounds_select" ON public.ito_rounds;
DROP POLICY IF EXISTS "ito_rounds_write" ON public.ito_rounds;
CREATE POLICY "ito_rounds_select" ON public.ito_rounds
  FOR SELECT TO authenticated USING (true);
-- フェーズ遷移は ito_advance_phase() 経由。ここは作成・削除用。
CREATE POLICY "ito_rounds_write" ON public.ito_rounds
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_groups_select" ON public.ito_groups;
DROP POLICY IF EXISTS "ito_groups_write" ON public.ito_groups;
CREATE POLICY "ito_groups_select" ON public.ito_groups
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ito_groups_write" ON public.ito_groups
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_group_members_select" ON public.ito_group_members;
DROP POLICY IF EXISTS "ito_group_members_write" ON public.ito_group_members;
CREATE POLICY "ito_group_members_select" ON public.ito_group_members
  FOR SELECT TO authenticated USING (true);
-- 代表者の選択は ito_set_leader() 経由。編成の作成・移動は管理者。
CREATE POLICY "ito_group_members_write" ON public.ito_group_members
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

-- 秘密数字: 自分の行だけ。結果発表以降はそのラウンドの参加者に開く。
-- 管理者にも結果発表前は見せない（配布状況は ito_secret_status() で取る）。
DROP POLICY IF EXISTS "ito_secrets_select" ON public.ito_secrets;
CREATE POLICY "ito_secrets_select" ON public.ito_secrets
  FOR SELECT TO authenticated USING (
    profile_id = auth.uid()
    OR (
      public.ito_round_phase(round_id) IN ('result', 'finished')
      AND public.ito_is_in_round(round_id)
    )
  );
-- INSERT/UPDATE/DELETE ポリシーは作らない＝RPC（SECURITY DEFINER）以外は書けない。

DROP POLICY IF EXISTS "ito_leader_answers_select" ON public.ito_leader_answers;
DROP POLICY IF EXISTS "ito_leader_answers_write" ON public.ito_leader_answers;
CREATE POLICY "ito_leader_answers_select" ON public.ito_leader_answers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ito_leader_answers_write" ON public.ito_leader_answers
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_group_orders_select" ON public.ito_group_orders;
DROP POLICY IF EXISTS "ito_group_orders_write" ON public.ito_group_orders;
CREATE POLICY "ito_group_orders_select" ON public.ito_group_orders
  FOR SELECT TO authenticated USING (public.ito_can_read_group(group_id));
-- 並び順の更新は ito_set_order()（revision 競合制御つき）経由のみ。
CREATE POLICY "ito_group_orders_write" ON public.ito_group_orders
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_round_scores_select" ON public.ito_round_scores;
DROP POLICY IF EXISTS "ito_round_scores_write" ON public.ito_round_scores;
CREATE POLICY "ito_round_scores_select" ON public.ito_round_scores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ito_round_scores_write" ON public.ito_round_scores
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

DROP POLICY IF EXISTS "ito_point_events_select" ON public.ito_point_events;
DROP POLICY IF EXISTS "ito_point_events_write" ON public.ito_point_events;
CREATE POLICY "ito_point_events_select" ON public.ito_point_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ito_point_events_write" ON public.ito_point_events
  FOR ALL TO authenticated USING (public.can_manage_system())
  WITH CHECK (public.can_manage_system());

-- ─────────────────────────────
-- 4. RPC
-- ─────────────────────────────

/** ラウンドのフェーズ遷移。許可表にない遷移は例外。src/lib/ito-phase.ts と同じ内容。 */
CREATE OR REPLACE FUNCTION public.ito_advance_phase(target_round_id UUID, to_phase TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_phase TEXT;
  allowed BOOLEAN;
BEGIN
  IF NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;

  SELECT phase INTO current_phase FROM public.ito_rounds WHERE id = target_round_id FOR UPDATE;
  IF current_phase IS NULL THEN
    RAISE EXCEPTION 'round not found';
  END IF;

  allowed := (current_phase, to_phase) IN (
    ('grouping', 'leader_select'),
    ('leader_select', 'numbers'),
    ('numbers', 'leader_answers'),
    ('leader_answers', 'ordering'),
    ('ordering', 'locked'),
    ('locked', 'revealed'),
    ('locked', 'ordering'),
    ('revealed', 'result'),
    ('result', 'finished')
  );
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid phase transition: % -> %', current_phase, to_phase;
  END IF;

  UPDATE public.ito_rounds
  SET phase = to_phase,
      started_at = CASE WHEN to_phase = 'leader_select' AND started_at IS NULL
                        THEN now() ELSE started_at END,
      ended_at = CASE WHEN to_phase = 'finished' THEN now() ELSE ended_at END
  WHERE id = target_round_id;

  RETURN to_phase;
END;
$$;

/** 招待への応答。招待行は本人だけが更新でき、履歴は上書きしない。 */
CREATE OR REPLACE FUNCTION public.ito_respond_invitation(invitation_id UUID, accept BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv public.ito_invitations%ROWTYPE;
  next_status TEXT;
BEGIN
  SELECT * INTO inv FROM public.ito_invitations WHERE id = invitation_id FOR UPDATE;
  IF inv.id IS NULL THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;
  IF inv.profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your invitation';
  END IF;
  IF inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation already answered';
  END IF;

  next_status := CASE WHEN accept THEN 'joined' ELSE 'declined' END;

  UPDATE public.ito_invitations
  SET status = next_status, responded_at = now()
  WHERE id = invitation_id;

  IF accept THEN
    INSERT INTO public.ito_participants (game_id, profile_id, status, joined_round, updated_at)
    VALUES (inv.game_id, inv.profile_id, 'active', inv.round_no, now())
    ON CONFLICT (game_id, profile_id) DO UPDATE
      SET status = 'active', left_round = NULL, updated_at = now();
  END IF;

  RETURN next_status;
END;
$$;

/** 代表者選択（グループ共有）。受付中は同じ班のメンバーなら誰でも変更できる。 */
CREATE OR REPLACE FUNCTION public.ito_set_leader(target_group_id UUID, leader_profile_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_round_id UUID;
  leader_team BOOLEAN;
BEGIN
  SELECT g.round_id, g.is_leader_team INTO target_round_id, leader_team
  FROM public.ito_groups g WHERE g.id = target_group_id;
  IF target_round_id IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF leader_team THEN
    RAISE EXCEPTION 'leader team has no leader';
  END IF;
  IF public.ito_round_phase(target_round_id) <> 'leader_select' THEN
    RAISE EXCEPTION 'leader selection is closed';
  END IF;
  IF NOT public.can_manage_system() AND NOT EXISTS (
    SELECT 1 FROM public.ito_group_members m
    WHERE m.group_id = target_group_id AND m.profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a member of this group';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ito_group_members m
    WHERE m.group_id = target_group_id AND m.profile_id = leader_profile_id
  ) THEN
    RAISE EXCEPTION 'leader must belong to this group';
  END IF;

  -- 部分ユニークインデックス（1グループ1代表者）に一時的にも触れないよう2段階で更新する。
  UPDATE public.ito_group_members
  SET is_leader = false
  WHERE group_id = target_group_id AND is_leader;

  UPDATE public.ito_group_members
  SET is_leader = true
  WHERE group_id = target_group_id AND profile_id = leader_profile_id;
END;
$$;

/** 秘密数字の配布。1〜100 から重複なしで代表者数ぶん抽選する。既に配布済みなら拒否。 */
CREATE OR REPLACE FUNCTION public.ito_assign_secrets(target_round_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  leader_count INTEGER;
BEGIN
  IF NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;
  IF public.ito_round_phase(target_round_id) <> 'numbers' THEN
    RAISE EXCEPTION 'not in number distribution phase';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ito_secrets WHERE round_id = target_round_id) THEN
    RAISE EXCEPTION 'secrets already assigned for this round';
  END IF;

  SELECT count(*) INTO leader_count
  FROM public.ito_group_members WHERE round_id = target_round_id AND is_leader;
  IF leader_count < 2 THEN
    RAISE EXCEPTION 'at least two leaders are required';
  END IF;

  INSERT INTO public.ito_secrets (round_id, profile_id, number)
  WITH leaders AS (
    SELECT profile_id, row_number() OVER (ORDER BY random()) AS rn
    FROM public.ito_group_members
    WHERE round_id = target_round_id AND is_leader
  ),
  picked AS (
    SELECT n FROM generate_series(1, 100) n ORDER BY random() LIMIT leader_count
  ),
  numbers AS (
    SELECT n, row_number() OVER () AS rn FROM picked
  )
  SELECT target_round_id, leaders.profile_id, numbers.n
  FROM leaders JOIN numbers ON numbers.rn = leaders.rn;

  RETURN leader_count;
END;
$$;

/** 本人が自分の数字を確認したことを記録する。 */
CREATE OR REPLACE FUNCTION public.ito_confirm_secret(target_round_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ito_secrets
  SET confirmed_at = COALESCE(confirmed_at, now())
  WHERE round_id = target_round_id AND profile_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no secret number for you in this round';
  END IF;
END;
$$;

/** 管理者向けの配布状況。数字そのものは返さない。 */
CREATE OR REPLACE FUNCTION public.ito_secret_status(target_round_id UUID)
RETURNS TABLE(profile_id UUID, assigned BOOLEAN, confirmed BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT m.profile_id,
         (s.profile_id IS NOT NULL) AS assigned,
         (s.confirmed_at IS NOT NULL) AS confirmed
  FROM public.ito_group_members m
  LEFT JOIN public.ito_secrets s
    ON s.round_id = m.round_id AND s.profile_id = m.profile_id
  WHERE m.round_id = target_round_id
    AND m.is_leader
    AND public.can_manage_system();
$$;

/**
 * グループ共有の並び順を更新する。
 * - 回答受付中（ordering）のみ
 * - 代表者は自班の編集不可、代表者チームは代表者のみ
 * - revision が一致しないときは競合として拒否
 * - 並びが変われば submitted は false に戻る
 */
CREATE OR REPLACE FUNCTION public.ito_set_order(
  target_group_id UUID,
  new_order UUID[],
  expected_revision INTEGER,
  submit BOOLEAN DEFAULT NULL
)
RETURNS public.ito_group_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_row public.ito_group_orders%ROWTYPE;
  target_round_id UUID;
  leader_ids UUID[];
  order_changed BOOLEAN;
BEGIN
  target_round_id := public.ito_group_round(target_group_id);
  IF target_round_id IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT public.ito_can_edit_group(target_group_id) THEN
    RAISE EXCEPTION 'you cannot edit this group answer now';
  END IF;

  SELECT array_agg(profile_id ORDER BY profile_id) INTO leader_ids
  FROM public.ito_group_members WHERE round_id = target_round_id AND is_leader;

  IF (SELECT array_agg(x ORDER BY x) FROM unnest(new_order) x) IS DISTINCT FROM leader_ids THEN
    RAISE EXCEPTION 'order must be a permutation of this round leaders';
  END IF;

  SELECT * INTO current_row FROM public.ito_group_orders
  WHERE group_id = target_group_id FOR UPDATE;

  IF current_row.group_id IS NULL THEN
    INSERT INTO public.ito_group_orders
      (group_id, round_id, order_ids, revision, submitted, updated_by, updated_at)
    VALUES (target_group_id, target_round_id, new_order, 1,
            COALESCE(submit, false), auth.uid(), now())
    RETURNING * INTO current_row;
    RETURN current_row;
  END IF;

  IF expected_revision IS NOT NULL AND expected_revision <> current_row.revision THEN
    RAISE EXCEPTION 'ito_order_conflict:%', current_row.revision;
  END IF;

  order_changed := current_row.order_ids IS DISTINCT FROM new_order;

  UPDATE public.ito_group_orders
  SET order_ids = new_order,
      revision = current_row.revision + 1,
      -- 並びを変えたら未提出へ戻す。submit 指定があればそれを優先。
      submitted = COALESCE(submit, CASE WHEN order_changed THEN false ELSE submitted END),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE group_id = target_group_id
  RETURNING * INTO current_row;

  RETURN current_row;
END;
$$;

/**
 * 採点結果の反映。計算は src/lib/ito-score.ts（純関数）で行い、ここは保存だけ。
 * 対象ラウンドの行だけを入れ替えるので、何度でも再採点できる。
 * scores: [{"group_id":uuid,"correct_count":int,"points":int,"is_perfect":bool}]
 * points: [{"profile_id":uuid,"points":int,"source":"group"|"leader_team"}]
 */
CREATE OR REPLACE FUNCTION public.ito_apply_scores(
  target_round_id UUID,
  scores JSONB,
  points JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_game_id UUID;
BEGIN
  IF NOT public.can_manage_system() THEN
    RAISE EXCEPTION 'system management permission required';
  END IF;
  IF public.ito_round_phase(target_round_id) NOT IN ('result', 'finished') THEN
    RAISE EXCEPTION 'scores can be applied only after the result is revealed';
  END IF;

  SELECT game_id INTO target_game_id FROM public.ito_rounds WHERE id = target_round_id;

  DELETE FROM public.ito_round_scores WHERE round_id = target_round_id;
  DELETE FROM public.ito_point_events WHERE round_id = target_round_id;

  INSERT INTO public.ito_round_scores
    (group_id, round_id, correct_count, points, is_perfect, computed_at)
  SELECT (s->>'group_id')::UUID, target_round_id, (s->>'correct_count')::INTEGER,
         (s->>'points')::INTEGER, COALESCE((s->>'is_perfect')::BOOLEAN, false), now()
  FROM jsonb_array_elements(scores) s;

  INSERT INTO public.ito_point_events
    (game_id, round_id, profile_id, points, source)
  SELECT target_game_id, target_round_id, (p->>'profile_id')::UUID,
         (p->>'points')::INTEGER, p->>'source'
  FROM jsonb_array_elements(points) p;
END;
$$;

REVOKE ALL ON FUNCTION public.ito_advance_phase(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_respond_invitation(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_set_leader(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_assign_secrets(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_confirm_secret(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_secret_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_set_order(UUID, UUID[], INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ito_apply_scores(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ito_advance_phase(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_respond_invitation(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_set_leader(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_assign_secrets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_confirm_secret(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_secret_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_set_order(UUID, UUID[], INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ito_apply_scores(UUID, JSONB, JSONB) TO authenticated;

-- ─────────────────────────────
-- 5. 招待通知（既存の通知センターに載せる）
-- ─────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('comment', 'notice', 'sync_failure', 'thread_reply', 'mention', 'ito_invite'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_reference_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_reference_type_check
  CHECK (reference_type IN ('record', 'tweet', 'schedule', 'notice', 'thread', 'ito'));

CREATE OR REPLACE FUNCTION public.handle_ito_invitation_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, actor_id, type, reference_type, reference_id)
  VALUES (NEW.profile_id, NEW.invited_by, 'ito_invite', 'ito', NEW.game_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ito_invitation_notification ON public.ito_invitations;
CREATE TRIGGER ito_invitation_notification
  AFTER INSERT ON public.ito_invitations
  FOR EACH ROW EXECUTE FUNCTION public.handle_ito_invitation_notification();

-- ─────────────────────────────
-- 6. Realtime（ito_secrets は載せない）
-- ─────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY[
      'ito_games', 'ito_invitations', 'ito_participants', 'ito_rounds', 'ito_groups',
      'ito_group_members', 'ito_leader_answers', 'ito_group_orders',
      'ito_round_scores', 'ito_point_events'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

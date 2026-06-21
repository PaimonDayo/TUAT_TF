-- 個別（対象者指定）メニューにもブロックを持たせ、同じブロックの部員からも
-- 他の人の個別メニューが見えるようにする。
-- 公開メニューの閲覧条件:
--   ・自分が対象者に含まれる
--   ・メニューのブロックが自分の所属ブロックに含まれる（同ブロックは閲覧可）
--   ・対象者なし かつ ブロック未指定（＝全体向け）
CREATE OR REPLACE FUNCTION public.can_view_practice_menu(target_menu_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM practice_menus menu
    WHERE menu.id = target_menu_id
      AND (
        public.can_create_menu()
        OR menu.author_id = auth.uid()
        OR (
          menu.status = 'published'
          AND (
            -- 自分が対象者
            EXISTS (
              SELECT 1
              FROM practice_menu_targets target
              WHERE target.menu_id = menu.id
                AND target.user_id = auth.uid()
            )
            -- 同じブロック（個別・ブロック共通どちらも、ブロックが自分に合えば閲覧可）
            OR (
              menu.target_block IS NOT NULL
              AND menu.target_block = ANY (
                COALESCE(
                  (SELECT profile.blocks FROM profiles profile WHERE profile.id = auth.uid()),
                  '{}'::TEXT[]
                )
              )
            )
            -- 全体向け（対象者なし・ブロック未指定）
            OR (
              menu.target_block IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM practice_menu_targets target
                WHERE target.menu_id = menu.id
              )
            )
          )
        )
      )
  );
$$;

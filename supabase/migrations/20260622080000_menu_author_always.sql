-- 作成者は自分が作ったメニューを（下書き・公開どちらも）常に閲覧できるように戻す。
-- 「他ブロックも見る」オフは“他人の他ブロックメニュー”を隠すための設定で、
-- 自分が作ったメニューは常に見えてよい（管理のため）。

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
        -- 自分が作成したメニューは常に閲覧可（下書き・公開とも）
        menu.author_id = auth.uid()
        -- 本人が「他ブロックも見る」をオンにしている場合は全メニュー閲覧可
        OR COALESCE(
          (SELECT p.menu_view_all_blocks FROM profiles p WHERE p.id = auth.uid()),
          FALSE
        )
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
            -- 同じブロック
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

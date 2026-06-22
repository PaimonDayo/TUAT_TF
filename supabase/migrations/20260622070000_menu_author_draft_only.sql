-- 「他ブロックのメニューも見る」がオフのとき、作成者でも他ブロックの“公開済み”メニューは見えないようにする。
-- 従来は menu.author_id = auth.uid() で作成者は全メニュー閲覧可だったため、
-- 全ブロックのメニューを作る管理者がトグルをオフにしても他ブロックのメニューが見え続けていた。
-- → 作成者が常に見えるのは「自分の下書き」だけにし、公開済みは通常のブロック/対象/全体＋トグルで判定する。

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
        -- 自分の下書きは常に閲覧可（公開前の編集・公開のため）
        (menu.author_id = auth.uid() AND menu.status = 'draft')
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

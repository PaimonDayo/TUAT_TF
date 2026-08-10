-- 進行役（システム管理者）が、部員の代わりに並び順を保存・提出できるようにする。
-- 用途:
--   - 端末が使えない部員の代理入力（合宿現場での復旧手段）
--   - 進行役ひとりでの通しテスト
-- 回答受付中（ordering）でしか編集できない制約はそのまま。
CREATE OR REPLACE FUNCTION public.ito_can_edit_group(target_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    public.ito_round_phase(public.ito_group_round(target_group_id)) = 'ordering'
    AND (
      public.can_manage_system()
      OR CASE
        WHEN EXISTS (SELECT 1 FROM public.ito_groups g
                     WHERE g.id = target_group_id AND g.is_leader_team)
          THEN public.ito_is_leader_in_round(public.ito_group_round(target_group_id))
        ELSE EXISTS (
          SELECT 1 FROM public.ito_group_members m
          WHERE m.group_id = target_group_id
            AND m.profile_id = auth.uid()
            AND NOT m.is_leader
        )
      END
    );
$$;

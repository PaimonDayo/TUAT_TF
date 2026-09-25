-- 公式結果を各部員のページに出すのは取りやめた（2026-09-25 オーナー判断）。
-- 読み取りを当初どおりシステム管理権限だけへ戻す。データは残す。
DROP POLICY IF EXISTS competition_result_links_member_read ON public.competition_result_links;
DROP POLICY IF EXISTS competition_result_links_system_read ON public.competition_result_links;
CREATE POLICY competition_result_links_system_read ON public.competition_result_links
  FOR SELECT TO authenticated USING (public.can_manage_system());

NOTIFY pgrst, 'reload schema';

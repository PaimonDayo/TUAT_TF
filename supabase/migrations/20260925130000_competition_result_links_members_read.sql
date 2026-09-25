-- 本名確認済みの公式結果を、部員全員がマイページ・部員ページで読めるようにする（2026-09-25 オーナー確定）。
-- 公式速報（competition_program_entries）と同じく、ログインした部員なら読める。書き込みは従来どおり service_role のみ。
DROP POLICY IF EXISTS competition_result_links_system_read ON public.competition_result_links;
DROP POLICY IF EXISTS competition_result_links_member_read ON public.competition_result_links;
CREATE POLICY competition_result_links_member_read ON public.competition_result_links
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';

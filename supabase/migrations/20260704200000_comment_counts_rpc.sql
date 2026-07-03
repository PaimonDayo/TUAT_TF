-- パフォーマンス改善(タスク5-P4): fetchCommentCountsの全行取得→JS集計を
-- DB側のGROUP BY集計に置き換えるためのRPC。
CREATE OR REPLACE FUNCTION public.count_comments_by_target(
  target_type_in TEXT,
  target_ids UUID[]
)
RETURNS TABLE(target_id UUID, count BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.target_id, COUNT(*)
  FROM comments c
  WHERE c.target_type = target_type_in
    AND c.target_id = ANY(target_ids)
  GROUP BY c.target_id;
$$;

REVOKE ALL ON FUNCTION public.count_comments_by_target(TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_comments_by_target(TEXT, UUID[]) TO authenticated;

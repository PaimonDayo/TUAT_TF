DROP VIEW IF EXISTS public.weekly_ranking;

ALTER TABLE public.practice_records
  ALTER COLUMN dist_low TYPE NUMERIC(6,2),
  ALTER COLUMN dist_mid TYPE NUMERIC(6,2),
  ALTER COLUMN dist_high TYPE NUMERIC(6,2),
  ALTER COLUMN dist_speed TYPE NUMERIC(6,2);

CREATE VIEW public.weekly_ranking
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.display_name,
  p.grade,
  p.blocks,
  p.avatar_url,
  COALESCE(SUM(r.dist_low), 0) AS km_low,
  COALESCE(SUM(r.dist_mid), 0) AS km_mid,
  COALESCE(SUM(r.dist_high), 0) AS km_high,
  COALESCE(SUM(r.dist_speed), 0) AS km_speed,
  COALESCE(SUM(
    COALESCE(r.dist_low, 0)
    + COALESCE(r.dist_mid, 0)
    + COALESCE(r.dist_high, 0)
    + COALESCE(r.dist_speed, 0)
  ), 0) AS total_km,
  ((NOW() AT TIME ZONE 'Asia/Tokyo')::date - 6) AS period_start,
  (NOW() AT TIME ZONE 'Asia/Tokyo')::date AS period_end
FROM public.profiles p
LEFT JOIN public.practice_records r
  ON r.user_id = p.id
  AND r.recorded_date >= (NOW() AT TIME ZONE 'Asia/Tokyo')::date - 6
  AND r.recorded_date <= (NOW() AT TIME ZONE 'Asia/Tokyo')::date
WHERE p.status = 'active'
  AND 'middle_long' = ANY(p.blocks)
GROUP BY p.id, p.display_name, p.grade, p.blocks, p.avatar_url
ORDER BY total_km DESC;

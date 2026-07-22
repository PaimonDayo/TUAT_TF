-- Jump and throw are now handled as part of the short-distance block.
-- Keep schema constraints backward-compatible, but normalize existing rows.

UPDATE public.profiles AS profile
SET blocks = (
  SELECT array_agg(normalized.mapped ORDER BY normalized.first_position)
  FROM (
    SELECT
      CASE
        WHEN item.block IN ('jump', 'throw') THEN 'short'
        ELSE item.block
      END AS mapped,
      MIN(item.position) AS first_position
    FROM unnest(profile.blocks) WITH ORDINALITY AS item(block, position)
    GROUP BY
      CASE
        WHEN item.block IN ('jump', 'throw') THEN 'short'
        ELSE item.block
      END
  ) AS normalized
)
WHERE profile.blocks && ARRAY['jump', 'throw']::TEXT[];

UPDATE public.practice_schedules AS schedule
SET target_blocks = (
  SELECT array_agg(normalized.mapped ORDER BY normalized.first_position)
  FROM (
    SELECT
      CASE
        WHEN item.block IN ('jump', 'throw') THEN 'short'
        ELSE item.block
      END AS mapped,
      MIN(item.position) AS first_position
    FROM unnest(schedule.target_blocks) WITH ORDINALITY AS item(block, position)
    GROUP BY
      CASE
        WHEN item.block IN ('jump', 'throw') THEN 'short'
        ELSE item.block
      END
  ) AS normalized
)
WHERE schedule.target_blocks && ARRAY['jump', 'throw']::TEXT[];

UPDATE public.notices AS notice
SET mentioned_blocks = (
  SELECT array_agg(normalized.mapped ORDER BY normalized.first_position)
  FROM (
    SELECT
      CASE
        WHEN item.block IN ('jump', 'throw') THEN 'short'
        ELSE item.block
      END AS mapped,
      MIN(item.position) AS first_position
    FROM unnest(notice.mentioned_blocks) WITH ORDINALITY AS item(block, position)
    GROUP BY
      CASE
        WHEN item.block IN ('jump', 'throw') THEN 'short'
        ELSE item.block
      END
  ) AS normalized
)
WHERE notice.mentioned_blocks && ARRAY['jump', 'throw']::TEXT[];

UPDATE public.practice_menus
SET target_block = 'short'
WHERE target_block IN ('jump', 'throw');

UPDATE public.schedule_sheets
SET target_block = 'short'
WHERE target_block IN ('jump', 'throw');

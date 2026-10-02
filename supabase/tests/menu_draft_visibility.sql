-- Run with psql -X -v ON_ERROR_STOP=1 after the current migrations.
-- Synthetic actors and menus only. Always rolled back; never change ROLLBACK to COMMIT.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('test.menu_visibility_owner', current_user, true);

INSERT INTO auth.users(id, email)
SELECT ('a6100202-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'menu-visibility-' || n || '@example.invalid'
FROM generate_series(1, 13) n;
INSERT INTO public.profiles(id, email, display_name, blocks, menu_view_all_blocks)
SELECT ('a6100202-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'menu-visibility-' || n || '@example.invalid', 'Menu visibility fixture',
  CASE n WHEN 2 THEN ARRAY['short'] WHEN 3 THEN ARRAY['middle_long']
    WHEN 4 THEN ARRAY['manager'] ELSE '{}'::text[] END,
  n IN (5, 8, 10)
FROM generate_series(1, 13) n
ON CONFLICT (id) DO UPDATE SET blocks = EXCLUDED.blocks,
  menu_view_all_blocks = EXCLUDED.menu_view_all_blocks;

INSERT INTO public.roles(id, name, can_create_menu, can_manage_members) VALUES
  ('a6100202-0000-4000-8100-000000000001', 'Menu visibility fixture creator', true, false),
  ('a6100202-0000-4000-8100-000000000002', 'Menu visibility fixture manager', false, true);
-- A legacy leader role may no longer exist in the current catalog. Recreate it
-- only inside this rollback transaction so its supported mapping is still tested.
INSERT INTO public.roles(id, name, can_create_menu)
SELECT ('a6100202-0000-4000-8100-' || lpad(n::text, 12, '0'))::uuid, name, true
FROM (VALUES (3, '短距離ブロック長'), (4, '長距離ブロック長'),
  (5, '跳躍ブロック長'), (6, '投擲ブロック長'), (7, '中距離ブロック長')) fixture(n, name)
WHERE NOT EXISTS (SELECT 1 FROM public.roles existing WHERE existing.name = fixture.name);
INSERT INTO public.profile_roles(profile_id, role_id)
SELECT ('a6100202-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'a6100202-0000-4000-8100-000000000001'::uuid
FROM unnest(ARRAY[6, 7, 10, 11, 12, 13]) n;
INSERT INTO public.profile_roles(profile_id, role_id) VALUES
  ('a6100202-0000-4000-8000-000000000008', 'a6100202-0000-4000-8100-000000000002');
INSERT INTO public.profile_roles(profile_id, role_id)
SELECT ('a6100202-0000-4000-8000-' || lpad(actor.n::text, 12, '0'))::uuid, role.id
FROM (VALUES (6, '短距離ブロック長'), (7, '長距離ブロック長'),
  (11, '跳躍ブロック長'), (12, '投擲ブロック長'), (13, '中距離ブロック長')) actor(n, name)
JOIN public.roles role ON role.name = actor.name;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profile_roles WHERE profile_id::text LIKE 'a6100202-%') <> 12 THEN
    RAISE EXCEPTION 'fixture roles missing or unexpected automatic assignment';
  END IF;
END $$;

INSERT INTO public.practice_schedules(id, schedule_date, schedule_type, created_by) VALUES
  ('a6100202-0000-4000-8200-000000000001', '2099-01-01', 'practice', 'a6100202-0000-4000-8000-000000000001');
INSERT INTO public.practice_menus(id, schedule_id, author_id, content, status, target_block)
SELECT ('a6100202-0000-4000-8300-' || lpad(n::text, 12, '0'))::uuid,
  'a6100202-0000-4000-8200-000000000001', 'a6100202-0000-4000-8000-000000000001',
  'Menu visibility fixture ' || n, CASE WHEN n <= 7 THEN 'draft' ELSE 'published' END,
  CASE (n - 1) % 7 WHEN 0 THEN 'short' WHEN 1 THEN 'middle_long'
    WHEN 2 THEN 'jump' WHEN 3 THEN 'throw' WHEN 6 THEN 'short' ELSE NULL END
FROM generate_series(1, 14) n;
INSERT INTO public.practice_menu_targets(menu_id, user_id)
SELECT ('a6100202-0000-4000-8300-' || lpad(n::text, 12, '0'))::uuid,
  'a6100202-0000-4000-8000-000000000009'::uuid
FROM unnest(ARRAY[1, 6, 8, 13]) n;

-- Explicit expected rows test both SELECT policies, not a copy of the SQL predicate.
CREATE FUNCTION pg_temp.assert_menu_visibility(expected integer[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE actual integer[]; actual_targets integer[]; expected_targets integer[];
BEGIN
  SELECT coalesce(array_agg(right(id::text, 12)::integer ORDER BY id), '{}') INTO actual
  FROM public.practice_menus WHERE id::text LIKE 'a6100202-%';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'menu SELECT mismatch for %: expected %, got %', auth.uid(), expected, actual;
  END IF;
  SELECT coalesce(array_agg(right(menu_id::text, 12)::integer ORDER BY menu_id), '{}') INTO actual_targets
  FROM public.practice_menu_targets WHERE menu_id::text LIKE 'a6100202-%';
  SELECT coalesce(array_agg(n ORDER BY n), '{}') INTO expected_targets
  FROM unnest(expected) n WHERE n IN (1, 6, 8, 13);
  IF actual_targets IS DISTINCT FROM expected_targets THEN
    RAISE EXCEPTION 'menu target SELECT mismatch for %', auth.uid();
  END IF;
END $$;

DO $$
DECLARE actor record;
BEGIN
  FOR actor IN SELECT * FROM (VALUES
    (1, ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14]), -- Author, even without creation permission.
    (2, ARRAY[8,12,14]),                           -- Same-block member.
    (3, ARRAY[9,12]),                              -- Other-block member.
    (4, ARRAY[8,9,12,14]),                         -- Manager block keeps both published blocks.
    (5, ARRAY[8,9,10,11,12,13,14]),                -- All-blocks preference never grants drafts.
    (6, ARRAY[1,3,4,7,8,10,11,12,14]),             -- Short leader, including legacy jump/throw blocks.
    (7, ARRAY[2,9,12]),                            -- Long leader.
    (8, ARRAY[8,9,10,11,12,13,14]),                -- Member management grants no extra draft visibility.
    (9, ARRAY[8,12,13]),                           -- Explicit recipient sees published only.
    (10, ARRAY[8,9,10,11,12,13,14]),               -- Creation permission alone grants no other drafts.
    (11, ARRAY[1,3,4,7,8,10,11,12,14]),            -- Jump leader.
    (12, ARRAY[1,3,4,7,8,10,11,12,14]),            -- Throw leader.
    (13, ARRAY[2,9,12])                            -- Middle leader.
  ) cases(n, expected) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'a6100202-0000-4000-8000-' || lpad(actor.n::text, 12, '0'),
      'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_menu_visibility(actor.expected);
    PERFORM set_config('role', current_setting('test.menu_visibility_owner'), true);
  END LOOP;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);
UPDATE public.profiles SET menu_view_all_blocks = false
WHERE id = 'a6100202-0000-4000-8000-000000000005';
DELETE FROM public.profile_roles WHERE profile_id = 'a6100202-0000-4000-8000-000000000006';
SELECT set_config('request.jwt.claims', '{"sub":"a6100202-0000-4000-8000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_menu_visibility(ARRAY[12]);
SELECT set_config('role', current_setting('test.menu_visibility_owner'), true);
SELECT set_config('request.jwt.claims', '{"sub":"a6100202-0000-4000-8000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_menu_visibility(ARRAY[12]);
SELECT set_config('role', current_setting('test.menu_visibility_owner'), true);

SELECT set_config('request.jwt.claims', '{}', true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    IF public.can_view_practice_menu('a6100202-0000-4000-8300-000000000012') THEN
      RAISE EXCEPTION 'anonymous visibility allowed';
    END IF;
    PERFORM pg_temp.assert_menu_visibility('{}');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- Some installations deny anon at the schema/table boundary already.
  END;
END $$;
SELECT set_config('role', current_setting('test.menu_visibility_owner'), true);
SELECT 'menu visibility: 13 actors, 14 menus, targets, preference off, revoked leader, anonymous passed' AS result;
ROLLBACK;

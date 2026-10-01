-- Run inside a rollback-only transaction after applying the migration.
-- Fixtures are synthetic. Never COMMIT this script.
BEGIN;
INSERT INTO auth.users(id,email) SELECT ('a6100100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'role-audit-'||n||'@example.invalid' FROM generate_series(1,5) n;
INSERT INTO public.profiles(id,email,display_name,blocks) SELECT ('a6100100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'role-audit-'||n||'@example.invalid','Permission fixture',ARRAY['short'] FROM generate_series(1,5) n ON CONFLICT(id) DO UPDATE SET blocks=ARRAY['short'];
INSERT INTO public.roles(id,name,can_create_menu,can_manage_members) VALUES
 ('a6100100-0000-4000-8100-000000000001','Permission fixture author',true,false),
 ('a6100100-0000-4000-8100-000000000002','Permission fixture manager',false,true);
INSERT INTO public.profile_roles(profile_id,role_id) VALUES
 ('a6100100-0000-4000-8000-000000000001','a6100100-0000-4000-8100-000000000001'),
 ('a6100100-0000-4000-8000-000000000004','a6100100-0000-4000-8100-000000000002');
INSERT INTO public.profile_roles(profile_id,role_id) SELECT 'a6100100-0000-4000-8000-000000000002',id FROM public.roles WHERE name='短距離ブロック長';
INSERT INTO public.profile_roles(profile_id,role_id) SELECT 'a6100100-0000-4000-8000-000000000003',id FROM public.roles WHERE name='長距離ブロック長';
INSERT INTO public.practice_schedules(id,schedule_date,schedule_type,created_by) VALUES('a6100100-0000-4000-8200-000000000001','2099-01-01','practice','a6100100-0000-4000-8000-000000000001');
INSERT INTO public.practice_menus(id,schedule_id,author_id,content,status,target_block) VALUES
 ('a6100100-0000-4000-8300-000000000001','a6100100-0000-4000-8200-000000000001','a6100100-0000-4000-8000-000000000001','fixture short','draft','short'),
 ('a6100100-0000-4000-8300-000000000002','a6100100-0000-4000-8200-000000000001','a6100100-0000-4000-8000-000000000001','fixture long','draft','middle_long');
SELECT set_config('request.jwt.claims','{"sub":"a6100100-0000-4000-8000-000000000002","role":"authenticated"}',true) IS NOT NULL;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 IF NOT public.can_edit_block_menu('short') OR public.can_edit_block_menu('middle_long') OR public.can_edit_block_menu(NULL) THEN RAISE EXCEPTION 'block scope wrong'; END IF;
 IF (SELECT count(*) FROM public.practice_menus WHERE id='a6100100-0000-4000-8300-000000000001')<>1 THEN RAISE EXCEPTION 'leader cannot see draft'; END IF;
 PERFORM public.save_practice_menu('a6100100-0000-4000-8200-000000000001','leader edit','published','short',ARRAY['a6100100-0000-4000-8000-000000000005'::uuid],'a6100100-0000-4000-8300-000000000001');
 IF (SELECT author_id FROM public.practice_menus WHERE id='a6100100-0000-4000-8300-000000000001')<>'a6100100-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'author changed'; END IF;
 IF (SELECT count(*) FROM public.practice_menu_targets WHERE menu_id='a6100100-0000-4000-8300-000000000001')<>1 THEN RAISE EXCEPTION 'targets not saved'; END IF;
 INSERT INTO public.practice_menu_targets(menu_id,user_id) VALUES('a6100100-0000-4000-8300-000000000001','a6100100-0000-4000-8000-000000000002');
 BEGIN
  INSERT INTO public.practice_menu_targets(menu_id,user_id) VALUES('a6100100-0000-4000-8300-000000000002','a6100100-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'other block targets changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.save_practice_menu('a6100100-0000-4000-8200-000000000001','escape','published','middle_long','{}','a6100100-0000-4000-8300-000000000001');
  RAISE EXCEPTION 'block escape accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.save_practice_menu('a6100100-0000-4000-8200-000000000001','other','published','short','{}','a6100100-0000-4000-8300-000000000002');
  RAISE EXCEPTION 'other block takeover accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.practice_menus SET author_id=auth.uid(),target_block='middle_long' WHERE id='a6100100-0000-4000-8300-000000000001';
  RAISE EXCEPTION 'direct author takeover accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.practice_menus SET status='draft' WHERE id='a6100100-0000-4000-8300-000000000001';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'direct status failed'; END IF;
 DELETE FROM public.practice_menus WHERE id='a6100100-0000-4000-8300-000000000001';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'leader deleted another author'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a6100100-0000-4000-8000-000000000003","role":"authenticated"}',true) IS NOT NULL;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.can_edit_block_menu('short') OR NOT public.can_edit_block_menu('middle_long') THEN RAISE EXCEPTION 'long scope wrong'; END IF;
 PERFORM public.save_practice_menu('a6100100-0000-4000-8200-000000000001','long leader','draft','middle_long','{}','a6100100-0000-4000-8300-000000000002');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a6100100-0000-4000-8000-000000000004","role":"authenticated"}',true) IS NOT NULL;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.can_create_menu() OR NOT public.can_manage_members() THEN RAISE EXCEPTION 'manager fixture wrong'; END IF;
 PERFORM public.save_practice_menu('a6100100-0000-4000-8200-000000000001','manager edit','published','middle_long','{}','a6100100-0000-4000-8300-000000000002');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a6100100-0000-4000-8000-000000000005","role":"authenticated"}',true) IS NOT NULL;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.save_practice_menu('a6100100-0000-4000-8200-000000000001','unauthorized','published','short','{}','a6100100-0000-4000-8300-000000000001');
  RAISE EXCEPTION 'member edited';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true) IS NOT NULL;
UPDATE public.roles SET can_decide_practice=true WHERE is_everyone;
SELECT set_config('request.jwt.claims','{"sub":"a6100100-0000-4000-8000-000000000005","role":"authenticated"}',true) IS NOT NULL;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT public.can_decide_practice() THEN RAISE EXCEPTION 'everyone decision missing'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true) IS NOT NULL;
DO $$ BEGIN IF public.can_decide_practice() THEN RAISE EXCEPTION 'anonymous decision allowed'; END IF; END $$;
SELECT 'block editing / draft visibility / target save / ownership / scope escape / deletion denial / member denial / manager-only / everyone decision passed' AS result;
ROLLBACK;

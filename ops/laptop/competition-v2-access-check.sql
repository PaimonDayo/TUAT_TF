BEGIN;
DO $$
DECLARE member_id uuid; admin_id uuid; fixture uuid;
BEGIN
 SELECT p.id INTO member_id FROM public.profiles p WHERE NOT EXISTS (
   SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
   WHERE pr.profile_id=p.id AND r.can_manage_system) ORDER BY p.id LIMIT 1;
 SELECT pr.profile_id INTO admin_id FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id WHERE r.can_manage_system LIMIT 1;
 IF member_id IS NULL OR admin_id IS NULL THEN RAISE EXCEPTION 'Existing test roles unavailable'; END IF;
 PERFORM set_config('pc_test.member',member_id::text,true);
 PERFORM set_config('pc_test.admin',admin_id::text,true);
 INSERT INTO public.pb_records(user_id,event_name,record) VALUES(admin_id,'pc-v2-access','10.00') RETURNING id INTO fixture;
 PERFORM set_config('pc_test.fixture',fixture::text,true);
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n integer;
BEGIN
 IF public.can_manage_system() THEN RAISE EXCEPTION 'Expected ordinary member'; END IF;
 UPDATE public.pb_records SET record='unauthorized' WHERE id=current_setting('pc_test.fixture')::uuid;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Member edited another user'; END IF;
 INSERT INTO public.pb_records(user_id,event_name,record,value_cs) VALUES(auth.uid(),'pc-v2-own','9.99',999);
 BEGIN
   INSERT INTO public.competition_events(name,sort_order,measure_type) VALUES('pc-v2-forbidden',90000,'time');
   RAISE EXCEPTION 'Member changed event catalog';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub',current_setting('pc_test.admin'),true); END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n integer;
BEGIN
 IF NOT public.can_manage_system() THEN RAISE EXCEPTION 'Expected existing system administrator'; END IF;
 UPDATE public.pb_records SET record='9.80',value_cs=980 WHERE id=current_setting('pc_test.fixture')::uuid;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Administrator edit failed'; END IF;
 INSERT INTO public.competition_events(name,sort_order,measure_type) VALUES('pc-v2-admin-event',90000,'distance');
END $$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','',true); END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
   IF EXISTS(SELECT 1 FROM public.pb_records LIMIT 1) THEN
     RAISE EXCEPTION 'Anonymous record read allowed';
   END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

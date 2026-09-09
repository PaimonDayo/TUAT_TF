-- Run only in the restored rehearsal DB; every fixture is rolled back.
BEGIN;
DO $$
DECLARE u uuid; a uuid; b uuid; c uuid;
BEGIN
 SELECT id INTO u FROM public.profiles ORDER BY id LIMIT 1;
 INSERT INTO public.pb_records(user_id,event_name,record,is_pb,is_ub) VALUES(u,'pc-v2-flags','10.00',true,true) RETURNING id INTO a;
 INSERT INTO public.pb_records(user_id,event_name,record,is_pb,is_ub) VALUES(u,'pc-v2-flags','9.90',true,false) RETURNING id INTO b;
 IF NOT EXISTS(SELECT 1 FROM public.pb_records WHERE id=a AND NOT is_pb AND is_ub) THEN RAISE EXCEPTION 'Independent UB lost while selecting PB'; END IF;
 UPDATE public.pb_records SET is_ub=true WHERE id=b;
 IF EXISTS(SELECT 1 FROM public.pb_records WHERE id=a AND (is_pb OR is_ub)) THEN RAISE EXCEPTION 'Previous UB not cleared'; END IF;
 INSERT INTO public.pb_records(user_id,event_name,record,is_pb,is_ub) VALUES(u,'pc-v2-flags','9.80',true,false) RETURNING id INTO c;
 IF NOT EXISTS(SELECT 1 FROM public.pb_records WHERE id=b AND NOT is_pb AND is_ub) THEN RAISE EXCEPTION 'Nested update cleared independent UB'; END IF;
 UPDATE public.pb_records SET is_pb=false WHERE id=c;
 IF NOT EXISTS(SELECT 1 FROM public.pb_records WHERE id=b AND is_ub) THEN RAISE EXCEPTION 'Explicit PB clearing changed UB'; END IF;
 INSERT INTO public.pb_records(user_id,event_name,record,stage,recorded_on) VALUES(u,'pc-v2-history','old text','pre_university',NULL);
 BEGIN
   INSERT INTO public.pb_records(user_id,event_name,record,value_cs) VALUES(u,'pc-v2-invalid','invalid',-1);
   RAISE EXCEPTION 'Negative value accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;

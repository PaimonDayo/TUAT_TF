-- Disposable synthetic database only. All acceptance data/state changes roll back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE '%synthetic%' AND NOT
     (current_database()='tuat_rls_review' AND current_setting('tuat.review.native_auth',true)='true') THEN
    RAISE EXCEPTION 'Owned synthetic database required';
  END IF;
  IF pc_ops.local_push_enabled() THEN RAISE EXCEPTION 'Install must not activate local Push'; END IF;
  IF has_function_privilege('authenticated','public.claim_local_push()','EXECUTE') OR
     has_function_privilege('anon','public.complete_local_push(uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'A browser role can deliver Push';
  END IF;
END $$;
-- This rolled-back replacement prevents provider dispatch in a complete schema.
CREATE OR REPLACE FUNCTION public.send_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{}',true);
INSERT INTO public.login_email_allowlist(email,created_by) VALUES
 ('push-one@example.invalid','ba611111-0000-4000-8000-000000000001'),
 ('push-two@example.invalid','ba611111-0000-4000-8000-000000000001');
-- Start the old trigger at O to prove restoration on opt-out.
ALTER TABLE public.notifications ENABLE TRIGGER on_notification_created_send_push;
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-4000-8000-000000000811','push-one@example.invalid'),
 ('00000000-0000-4000-8000-000000000812','push-two@example.invalid');
INSERT INTO public.push_subscriptions(id,user_id,endpoint,p256dh,auth) VALUES
 ('00000000-0000-4000-8000-000000000821','00000000-0000-4000-8000-000000000811','https://fcm.googleapis.com/synthetic-one','fake','fake'),
 ('00000000-0000-4000-8000-000000000822','00000000-0000-4000-8000-000000000812','https://fcm.googleapis.com/synthetic-two','fake','fake');
INSERT INTO public.notifications(id,user_id,type) VALUES
 ('00000000-0000-4000-8000-000000000830','00000000-0000-4000-8000-000000000811','notice');
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pc_ops.local_push_delivery) THEN RAISE EXCEPTION 'Default install queued Push'; END IF;
  BEGIN PERFORM pc_ops.set_local_push_enabled(true); RAISE EXCEPTION 'Opt-in marker missing was accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('pc_ops.local_runtime','on',true);
SELECT pc_ops.set_local_push_enabled(true);
SELECT pc_ops.set_local_push_enabled(true);
DO $$ BEGIN
  IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.notifications'::regclass AND tgname='on_notification_created_send_push')<>'D' THEN
    RAISE EXCEPTION 'Local activation did not disable duplicate cloud delivery'; END IF;
END $$;
INSERT INTO public.notifications(id,user_id,type) VALUES
 ('00000000-0000-4000-8000-000000000831','00000000-0000-4000-8000-000000000811','notice');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000811"}',true);
SELECT set_config('request.headers','{}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
  result:=public.send_test_push_to_subscription('https://fcm.googleapis.com/synthetic-two');
  IF result->>'reason'<>'no_subscription' THEN RAISE EXCEPTION 'Another member device accepted'; END IF;
  result:=public.send_test_push_to_subscription('https://fcm.googleapis.com/synthetic-one');
  IF result->>'sent'<>'true' OR result->>'subscriptions'<>'1' THEN RAISE EXCEPTION 'Own test device not queued'; END IF;
  BEGIN PERFORM public.claim_local_push(); RAISE EXCEPTION 'Member delivery accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM pc_ops.local_push_delivery)<>2 THEN RAISE EXCEPTION 'Expected one notice and one device test'; END IF;
  IF EXISTS(SELECT 1 FROM pc_ops.local_push_delivery WHERE record->>'type'='test' AND record->>'subscription_id'<>'00000000-0000-4000-8000-000000000821') THEN
    RAISE EXCEPTION 'Test ownership scope changed'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
  result:=public.claim_local_push();
  IF jsonb_array_length(result)<>2 THEN RAISE EXCEPTION 'Service did not claim pending once'; END IF;
  IF jsonb_array_length(public.claim_local_push())<>0 THEN RAISE EXCEPTION 'Claim was replayed'; END IF;
END $$;
RESET ROLE;
UPDATE pc_ops.local_push_delivery SET claimed_at=now()-interval '1 day';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF jsonb_array_length(public.claim_local_push())<>0 THEN RAISE EXCEPTION 'Expired claim was replayed'; END IF;
  IF NOT public.complete_local_push('00000000-0000-4000-8000-000000000831','uncertain','{"sent":0,"dropped":0,"failed":0,"uncertain":1}') THEN
    RAISE EXCEPTION 'Uncertain result not recorded'; END IF;
  IF public.complete_local_push('00000000-0000-4000-8000-000000000831','delivered','{}') THEN RAISE EXCEPTION 'Uncertain overwritten as success'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO public.notifications(id,user_id,type) VALUES
 ('00000000-0000-4000-8000-000000000832','00000000-0000-4000-8000-000000000811','notice');
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF jsonb_array_length(public.claim_local_push())<>0 THEN RAISE EXCEPTION 'Mirror delivery accepted'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM pc_ops.local_push_delivery)<>2 THEN RAISE EXCEPTION 'Mirror queued duplicate Push'; END IF;
END $$;
SELECT set_config('request.headers','{}',true);
UPDATE pc_ops.backup_policy SET read_only=true WHERE singleton;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM public.claim_local_push(); RAISE EXCEPTION 'Backup service claim accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN PERFORM public.complete_local_push('00000000-0000-4000-8000-000000000831','failed','{}'); RAISE EXCEPTION 'Backup service complete accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000811"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.send_test_push_to_subscription('https://fcm.googleapis.com/synthetic-one'); RAISE EXCEPTION 'Backup test RPC accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
UPDATE pc_ops.backup_policy SET read_only=false WHERE singleton;
SELECT pc_ops.set_local_push_enabled(false);
SELECT pc_ops.set_local_push_enabled(false);
DO $$ BEGIN
  IF pc_ops.local_push_enabled() OR (SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.notifications'::regclass AND tgname='on_notification_created_send_push')<>'O' THEN
    RAISE EXCEPTION 'Cloud trigger mode not restored'; END IF;
END $$;
ROLLBACK;
SELECT 'local Push: opt-in, owner scope, claim once, mirror, backup read-only, restore: PASS';

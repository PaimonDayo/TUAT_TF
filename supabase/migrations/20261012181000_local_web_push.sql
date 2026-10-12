-- Local opt-in only. Existing cloud trigger/RPC/Vault configuration is untouched on install.
-- pc_ops holds local delivery state, excluded from cloud mirror/writeback deliberately:
-- copying it would replay side effects. No Vault, pg_net, Edge daemon or new public table.
BEGIN;
CREATE SCHEMA IF NOT EXISTS pc_ops;
REVOKE ALL ON SCHEMA pc_ops FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS pc_ops.local_push_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  cloud_trigger_mode "char"
);
INSERT INTO pc_ops.local_push_policy(singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS pc_ops.local_push_delivery (
  id uuid PRIMARY KEY,
  record jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','delivered','failed','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  counts jsonb
);
REVOKE ALL ON pc_ops.local_push_policy, pc_ops.local_push_delivery FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS local_push_pending ON pc_ops.local_push_delivery(created_at,id) WHERE state='pending';
DROP TRIGGER IF EXISTS pc_backup_read_only ON pc_ops.local_push_delivery;
CREATE TRIGGER pc_backup_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON pc_ops.local_push_delivery
  FOR EACH STATEMENT EXECUTE FUNCTION pc_ops.guard_backup_writes();

CREATE OR REPLACE FUNCTION pc_ops.local_push_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce((SELECT enabled FROM pc_ops.local_push_policy WHERE singleton),false);
$$;
REVOKE ALL ON FUNCTION pc_ops.local_push_enabled() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pc_ops.enqueue_local_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT pc_ops.local_push_enabled() OR public.is_mirror_write() OR public.backup_read_only() THEN RETURN NEW; END IF;
  INSERT INTO pc_ops.local_push_delivery(id,record) VALUES(NEW.id,to_jsonb(NEW)) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION pc_ops.enqueue_local_notification() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS on_notification_created_local_push ON public.notifications;
CREATE TRIGGER on_notification_created_local_push AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION pc_ops.enqueue_local_notification();

CREATE OR REPLACE FUNCTION pc_ops.enqueue_local_test(subscription_endpoint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE member uuid:=auth.uid(); selected uuid; identity uuid:=gen_random_uuid(); n integer;
BEGIN
  PERFORM public.assert_primary_writable();
  IF member IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF public.is_mirror_write() OR NOT pc_ops.local_push_enabled() THEN
    RETURN jsonb_build_object('sent',false,'reason','not_configured','subscriptions',0);
  END IF;
  SELECT count(*) INTO n FROM public.push_subscriptions
    WHERE user_id=member AND (subscription_endpoint IS NULL OR endpoint=subscription_endpoint);
  IF n=0 THEN RETURN jsonb_build_object('sent',false,'reason','no_subscription','subscriptions',0); END IF;
  IF subscription_endpoint IS NOT NULL THEN
    SELECT id INTO selected FROM public.push_subscriptions WHERE user_id=member AND endpoint=subscription_endpoint;
  END IF;
  INSERT INTO pc_ops.local_push_delivery(id,record) VALUES(identity,jsonb_build_object(
    'id',identity,'user_id',member,'type','test','subscription_id',selected,
    'reference_type',NULL,'reference_id',NULL));
  RETURN jsonb_build_object('sent',true,'subscriptions',n);
END;
$$;
REVOKE ALL ON FUNCTION pc_ops.enqueue_local_test(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_local_push()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.assert_primary_writable();
  IF public.is_mirror_write() OR NOT pc_ops.local_push_enabled() THEN RETURN '[]'::jsonb; END IF;
  -- A finite batch limits one request, not total recipients. Future calls drain remaining pending.
  -- claimed entries have no lease/reset: crash/timeout never permits automatic resend.
  WITH next AS (
    SELECT id FROM pc_ops.local_push_delivery WHERE state='pending'
    ORDER BY created_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE pc_ops.local_push_delivery d SET state='claimed',claimed_at=now()
    FROM next WHERE d.id=next.id RETURNING d.id,d.record
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'record',record)),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_local_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_local_push() TO service_role;

CREATE OR REPLACE FUNCTION public.complete_local_push(delivery_id uuid,outcome text,counts jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
  PERFORM public.assert_primary_writable();
  IF public.is_mirror_write() OR NOT pc_ops.local_push_enabled() THEN RETURN false; END IF;
  IF outcome NOT IN ('delivered','failed','uncertain') OR counts IS NULL THEN
    RAISE EXCEPTION 'Invalid local Push outcome';
  END IF;
  UPDATE pc_ops.local_push_delivery SET state=outcome,completed_at=now(),counts=$3
    WHERE id=delivery_id AND state='claimed';
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_local_push(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_local_push(uuid,text,jsonb) TO service_role;

-- Admin activation is separate from installation, and requires an explicit local session marker.
-- RPC source injection leaves default/cloud logic intact when local policy is disabled.
CREATE OR REPLACE FUNCTION pc_ops.set_local_push_enabled(enable boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE routine record; guarded text; mode "char"; previous boolean;
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin','cli_login_postgres') OR
    coalesce(current_setting('pc_ops.local_runtime',true),'')<>'on' THEN
    RAISE EXCEPTION 'Explicit local administrator session required' USING ERRCODE='42501';
  END IF;
  PERFORM public.assert_primary_writable();
  SELECT enabled INTO previous FROM pc_ops.local_push_policy WHERE singleton FOR UPDATE;
  IF enable=previous THEN RETURN; END IF;
  IF enable THEN
    FOR routine IN SELECT p.oid,p.prosrc,pg_get_userbyid(p.proowner) owner,pg_get_functiondef(p.oid) definition FROM pg_proc p
      WHERE p.oid IN (to_regprocedure('public.send_test_push()'),to_regprocedure('public.send_test_push_to_subscription(text)'))
    LOOP
      IF position('pc_ops.enqueue_local_test' in routine.prosrc)>0 THEN CONTINUE; END IF;
      IF position('BEGIN' in routine.prosrc)=0 THEN RAISE EXCEPTION 'Expected existing PL/pgSQL Push RPC'; END IF;
      IF routine.owner NOT IN ('postgres','supabase_admin','cli_login_postgres') THEN RAISE EXCEPTION 'Expected existing administrator-owned Push RPC'; END IF;
      EXECUTE format('GRANT USAGE ON SCHEMA pc_ops TO %I',routine.owner);
      EXECUTE format('GRANT EXECUTE ON FUNCTION pc_ops.local_push_enabled(),pc_ops.enqueue_local_test(text) TO %I',routine.owner);
      guarded:=regexp_replace(routine.prosrc,'\mBEGIN\M',E'BEGIN\n  IF pc_ops.local_push_enabled() THEN RETURN pc_ops.enqueue_local_test(' ||
        CASE WHEN routine.oid=to_regprocedure('public.send_test_push()') THEN 'NULL' ELSE 'subscription_endpoint' END || E'); END IF;');
      EXECUTE replace(routine.definition,routine.prosrc,guarded);
    END LOOP;
    SELECT tgenabled INTO mode FROM pg_trigger WHERE tgrelid='public.notifications'::regclass
      AND tgname='on_notification_created_send_push' AND NOT tgisinternal;
    UPDATE pc_ops.local_push_policy SET cloud_trigger_mode=mode WHERE singleton;
    IF mode IS NOT NULL THEN ALTER TABLE public.notifications DISABLE TRIGGER on_notification_created_send_push; END IF;
  ELSE
    SELECT cloud_trigger_mode INTO mode FROM pc_ops.local_push_policy WHERE singleton;
    IF mode='O' THEN ALTER TABLE public.notifications ENABLE TRIGGER on_notification_created_send_push;
    ELSIF mode='A' THEN ALTER TABLE public.notifications ENABLE ALWAYS TRIGGER on_notification_created_send_push;
    ELSIF mode='R' THEN ALTER TABLE public.notifications ENABLE REPLICA TRIGGER on_notification_created_send_push;
    ELSIF mode='D' THEN ALTER TABLE public.notifications DISABLE TRIGGER on_notification_created_send_push;
    END IF;
  END IF;
  UPDATE pc_ops.local_push_policy SET enabled=enable WHERE singleton;
END;
$$;
REVOKE ALL ON FUNCTION pc_ops.set_local_push_enabled(boolean) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

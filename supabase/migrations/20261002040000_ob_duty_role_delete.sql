-- Duty roles with assignments cannot be removed, including during failover replay.
CREATE OR REPLACE FUNCTION public.guard_ob_duty_role_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.is_mirror_write() THEN RETURN OLD; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 IF EXISTS(SELECT 1 FROM public.ob_meet_duties WHERE OLD.id=ANY(role_ids))
  OR EXISTS(SELECT 1 FROM public.ob_entry_duties WHERE OLD.id=ANY(role_ids))
 THEN RAISE EXCEPTION 'role_assigned'; END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_ob_duty_role_delete() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_ob_duty_role_delete ON public.ob_duty_roles;
CREATE TRIGGER guard_ob_duty_role_delete BEFORE DELETE ON public.ob_duty_roles
 FOR EACH ROW EXECUTE FUNCTION public.guard_ob_duty_role_delete();

CREATE OR REPLACE FUNCTION public.delete_ob_duty_role(p_id uuid,p_slot_time text,p_event_name text,p_revision integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_ob_meet() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ob-2026/duties',0));
 DELETE FROM public.ob_duty_roles WHERE id=p_id AND meet_key='ob-2026'
  AND slot_time=p_slot_time AND event_name=p_event_name AND revision=p_revision RETURNING id INTO removed;
 IF removed IS NULL THEN RAISE EXCEPTION 'entry_conflict'; END IF;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.delete_ob_duty_role(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_ob_duty_role(uuid,text,text,integer) TO authenticated;
-- The existing zz_log_failover_change on ob_duty_roles records its DELETE and primary key.
NOTIFY pgrst,'reload schema';

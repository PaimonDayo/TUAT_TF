-- OB operational writes belong to the configured meet staff. Other meets keep their current policy.
CREATE OR REPLACE FUNCTION public.competition_meet_permissions(p_competition_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH flags AS (SELECT
  EXISTS(SELECT 1 FROM public.competition_meets m JOIN public.roles r ON r.id=m.staff_role_id WHERE m.competition_id=p_competition_id AND (r.is_everyone OR EXISTS(SELECT 1 FROM public.profile_roles pr WHERE pr.role_id=r.id AND pr.profile_id=auth.uid()))) staff,
  public.can_manage_system() system,
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved) registrant,
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approved AND status='active') member,
  EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=p_competition_id AND legacy_source='ob-2026') legacy)
 SELECT jsonb_build_object(
  'manage',registrant AND (staff OR (system AND NOT legacy)),
  'groups',registrant AND (staff OR (system AND NOT legacy)),
  'record',registrant AND (staff OR (NOT legacy AND (system OR member))),
  'register',registrant AND (NOT legacy OR staff),
  'configure',registrant AND system,
  'history',registrant AND (staff OR (NOT legacy AND (system OR public.can_manage_members())))) FROM flags
$$;
REVOKE ALL ON FUNCTION public.competition_meet_permissions(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.competition_meet_permissions(text) TO authenticated;

-- Every successful mutation commits its immutable request in the same transaction.
-- Enforce owner/party writes too: those previously permitted self-service independently of register.
-- Rejecting the ledger insert rolls back the entire mutation, including preceding row changes.
CREATE OR REPLACE FUNCTION public.guard_ob_meet_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role'
  AND EXISTS(SELECT 1 FROM public.competition_meets WHERE competition_id=NEW.competition_id AND legacy_source='ob-2026')
  AND NOT coalesce((public.competition_meet_permissions(NEW.competition_id)->>'manage')::boolean,false)
  AND NOT (NEW.command->>'action' IN ('meet.configure','event.configure') AND coalesce((public.competition_meet_permissions(NEW.competition_id)->>'configure')::boolean,false))
 THEN RAISE EXCEPTION 'meet_forbidden' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_ob_meet_request() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_ob_operator ON public.competition_meet_requests;
CREATE TRIGGER guard_ob_operator BEFORE INSERT ON public.competition_meet_requests FOR EACH ROW EXECUTE FUNCTION public.guard_ob_meet_request();

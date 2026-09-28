-- Others' entries: OB staff only. Audit readers: administrators only.
CREATE OR REPLACE FUNCTION public.can_manage_ob_meet() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profile_roles pr JOIN public.roles r ON r.id=pr.role_id
    WHERE pr.profile_id=auth.uid() AND r.name='OB戦2026')
$$;
REVOKE ALL ON FUNCTION public.can_manage_ob_meet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_ob_meet() TO authenticated;

DROP POLICY IF EXISTS ob_entry_changes_system_read ON public.ob_entry_changes;
CREATE POLICY ob_entry_changes_system_read ON public.ob_entry_changes FOR SELECT TO authenticated
  USING (public.can_manage_system() OR public.can_manage_members());
CREATE INDEX IF NOT EXISTS ob_entry_changes_recent_idx ON public.ob_entry_changes(changed_at DESC, id DESC);

-- Party-only responses need an audit record even without a competition entry.
ALTER TABLE public.ob_entry_changes ALTER COLUMN entry_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.log_ob_party_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'revision')=(to_jsonb(NEW)-'revision') THEN RETURN NEW; END IF;
  INSERT INTO public.ob_entry_changes(entry_id,actor_id,before_data,after_data)
  VALUES(NEW.entry_id,auth.uid(),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)||'{"change_type":"party"}'::jsonb ELSE NULL END,
    to_jsonb(NEW)||'{"change_type":"party"}'::jsonb);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_ob_party_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS log_ob_party_change ON public.ob_party_responses;
CREATE TRIGGER log_ob_party_change AFTER INSERT OR UPDATE ON public.ob_party_responses
  FOR EACH ROW EXECUTE FUNCTION public.log_ob_party_change();

-- Preserve original actors/timestamps through fallback replay, rather than
-- recreating audit records using the mirror's service account. Existing table.
DROP TRIGGER IF EXISTS zz_log_failover_change ON public.ob_entry_changes;
CREATE TRIGGER zz_log_failover_change AFTER INSERT OR UPDATE OR DELETE ON public.ob_entry_changes
  FOR EACH ROW EXECUTE FUNCTION public.log_failover_change('id');

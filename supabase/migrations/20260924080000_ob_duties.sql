CREATE TABLE IF NOT EXISTS public.ob_meet_duties (
  meet_key text NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slot_time text NOT NULL CHECK(slot_time IN ('10:00','10:30','11:00','11:40','13:00','13:30','14:30','15:00','15:30')),
  assignment text NOT NULL CHECK(length(assignment)<=200),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  PRIMARY KEY(meet_key,profile_id,slot_time)
);
ALTER TABLE public.ob_meet_duties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_meet_duties FROM anon,authenticated;
GRANT SELECT ON public.ob_meet_duties TO authenticated;
GRANT ALL ON public.ob_meet_duties TO service_role;
DROP POLICY IF EXISTS ob_duties_system_read ON public.ob_meet_duties;
CREATE POLICY ob_duties_system_read ON public.ob_meet_duties FOR SELECT TO authenticated USING(public.can_manage_system());
CREATE OR REPLACE FUNCTION public.save_ob_duty(p_profile_id uuid,p_slot_time text,p_assignment text,p_revision integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_meet_duties%ROWTYPE; next_revision integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  IF p_slot_time IS NULL OR p_slot_time NOT IN ('10:00','10:30','11:00','11:40','13:00','13:30','14:30','15:00','15:30')
    OR p_assignment IS NULL OR length(p_assignment)>200 OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile_id AND approved AND status='active') THEN RAISE EXCEPTION 'entry_member_missing'; END IF;
  SELECT * INTO target FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time FOR UPDATE;
  IF FOUND THEN
    IF p_revision IS NULL OR target.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
    IF target.assignment=btrim(p_assignment) THEN RETURN target.revision; END IF;
    UPDATE public.ob_meet_duties SET assignment=btrim(p_assignment),revision=revision+1
      WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time RETURNING revision INTO next_revision;
  ELSE
    IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_conflict'; END IF;
    BEGIN
      INSERT INTO public.ob_meet_duties(meet_key,profile_id,slot_time,assignment) VALUES('ob-2026',p_profile_id,p_slot_time,btrim(p_assignment)) RETURNING revision INTO next_revision;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'entry_conflict'; END;
  END IF;
  RETURN next_revision;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_duty(uuid,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_duty(uuid,text,text,integer) TO authenticated;
NOTIFY pgrst,'reload schema';

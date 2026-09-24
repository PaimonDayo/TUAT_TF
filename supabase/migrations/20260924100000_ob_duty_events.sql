CREATE TABLE IF NOT EXISTS public.ob_duty_event_slots (slot_time text NOT NULL,event_name text NOT NULL,PRIMARY KEY(slot_time,event_name));
ALTER TABLE public.ob_duty_event_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ob_duty_event_slots FROM anon,authenticated;
INSERT INTO public.ob_duty_event_slots VALUES ('10:00','1500m'),('10:30','ジャベリックスロー'),('10:30','立ち五段跳び'),('11:00','100m'),('11:00','砲丸投げ'),('11:40','300mH'),('13:00','走り高跳び'),('13:30','300m'),('14:30','やり投げ'),('14:30','走り幅跳び'),('15:00','3000m'),('15:30','4×300mリレー') ON CONFLICT DO NOTHING;
ALTER TABLE public.ob_meet_duties ADD COLUMN IF NOT EXISTS event_name text;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.ob_meet_duties WHERE event_name IS NULL AND slot_time IN ('10:30','11:00','14:30')) THEN RAISE EXCEPTION 'Existing combined assignments require explicit event selection'; END IF;
END $$;
UPDATE public.ob_meet_duties d SET event_name=s.event_name FROM public.ob_duty_event_slots s WHERE d.slot_time=s.slot_time AND d.event_name IS NULL;
ALTER TABLE public.ob_meet_duties ALTER COLUMN event_name SET NOT NULL;
ALTER TABLE public.ob_meet_duties DROP CONSTRAINT IF EXISTS ob_meet_duties_pkey;
ALTER TABLE public.ob_meet_duties ADD PRIMARY KEY(meet_key,profile_id,slot_time,event_name);
ALTER TABLE public.ob_meet_duties DROP CONSTRAINT IF EXISTS ob_duty_event_fk;
ALTER TABLE public.ob_meet_duties ADD CONSTRAINT ob_duty_event_fk FOREIGN KEY(slot_time,event_name) REFERENCES public.ob_duty_event_slots;
DROP FUNCTION IF EXISTS public.save_ob_duty(uuid,text,text,integer);
CREATE OR REPLACE FUNCTION public.save_ob_duty(p_profile_id uuid,p_slot_time text,p_assignment text,p_revision integer,p_event_name text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.ob_meet_duties%ROWTYPE; next_revision integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_system() THEN RAISE EXCEPTION 'entry_forbidden' USING ERRCODE='42501'; END IF;
  IF p_slot_time IS NULL OR p_slot_time NOT IN ('10:00','10:30','11:00','11:40','13:00','13:30','14:30','15:00','15:30')
    OR p_assignment IS NULL OR length(p_assignment)>200 OR p_revision<0 THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile_id AND approved AND status='active') THEN RAISE EXCEPTION 'entry_member_missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.ob_meet_entries e ON e.profile_id=p.id AND e.meet_key='ob-2026' WHERE p.id=p_profile_id AND p.grade::text IN ('1','2','B1','B2') AND e.grade<>'OB・OG') THEN RAISE EXCEPTION 'entry_helper_ineligible'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ob_duty_event_slots WHERE slot_time=p_slot_time AND event_name=p_event_name) THEN RAISE EXCEPTION 'entry_invalid'; END IF;
  SELECT * INTO target FROM public.ob_meet_duties WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time AND event_name=p_event_name FOR UPDATE;
  IF FOUND THEN
    IF p_revision IS NULL OR target.revision<>p_revision THEN RAISE EXCEPTION 'entry_conflict'; END IF;
    IF target.assignment=btrim(p_assignment) THEN RETURN target.revision; END IF;
    UPDATE public.ob_meet_duties SET assignment=btrim(p_assignment),revision=revision+1
      WHERE meet_key='ob-2026' AND profile_id=p_profile_id AND slot_time=p_slot_time AND event_name=p_event_name RETURNING revision INTO next_revision;
  ELSE
    IF p_revision IS NOT NULL THEN RAISE EXCEPTION 'entry_conflict'; END IF;
    BEGIN
      INSERT INTO public.ob_meet_duties(meet_key,profile_id,slot_time,assignment,event_name) VALUES('ob-2026',p_profile_id,p_slot_time,btrim(p_assignment),p_event_name) RETURNING revision INTO next_revision;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'entry_conflict'; END;
  END IF;
  RETURN next_revision;
END $$;
REVOKE ALL ON FUNCTION public.save_ob_duty(uuid,text,text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_ob_duty(uuid,text,text,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';

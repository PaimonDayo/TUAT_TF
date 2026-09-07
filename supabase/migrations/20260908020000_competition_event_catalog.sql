CREATE TABLE IF NOT EXISTS public.competition_events (
  name text PRIMARY KEY CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 50),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order>=0)
);
ALTER TABLE public.competition_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_events_read ON public.competition_events;
CREATE POLICY competition_events_read ON public.competition_events FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS competition_events_manage ON public.competition_events;
CREATE POLICY competition_events_manage ON public.competition_events FOR ALL TO authenticated
USING (public.can_manage_system()) WITH CHECK (public.can_manage_system());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.competition_events TO authenticated;
INSERT INTO public.competition_events(name,sort_order)
SELECT name, ordinality::integer * 10 FROM unnest(ARRAY[
  '100m','200m','400m','800m','1500m','3000m','5000m','10000m',
  '100mH','110mH','400mH','3000mSC','5000mW','10000mW',
  '4×100mR','4×400mR','走高跳','棒高跳','走幅跳','三段跳',
  '砲丸投','円盤投','ハンマー投','やり投','七種競技','十種競技','ハーフ','マラソン','駅伝'
]) WITH ORDINALITY AS events(name,ordinality) ON CONFLICT DO NOTHING;
-- Preserve every previously entered event, including custom names.
INSERT INTO public.competition_events(name,sort_order)
SELECT DISTINCT event,1000 FROM public.competition_goals ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='competition_goals_event_fkey' AND conrelid='public.competition_goals'::regclass) THEN
    ALTER TABLE public.competition_goals ADD CONSTRAINT competition_goals_event_fkey
    FOREIGN KEY(event) REFERENCES public.competition_events(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;
NOTIFY pgrst,'reload schema';

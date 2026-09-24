-- Competition category, not an inference from a member's name or identity.
ALTER TABLE public.ob_meet_entries ADD COLUMN IF NOT EXISTS competition_division text
  CHECK (competition_division IN ('男子','女子'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.ob_meet_entries e
    WHERE (SELECT count(DISTINCT left(x,2)) FROM unnest(e.events) x)>1)
  THEN RAISE EXCEPTION 'entry_division_review_required'; END IF;
END $$;

-- Recover the last registered category for cancelled entries, too.
UPDATE public.ob_meet_entries e SET competition_division = COALESCE(
  left(e.events[1],2),
  (SELECT left(c.after_data->'events'->>0,2) FROM public.ob_entry_changes c
    WHERE c.entry_id=e.id AND jsonb_array_length(c.after_data->'events')>0
    ORDER BY c.changed_at DESC,c.id DESC LIMIT 1),
  (SELECT left(c.before_data->'events'->>0,2) FROM public.ob_entry_changes c
    WHERE c.entry_id=e.id AND jsonb_array_length(c.before_data->'events')>0
    ORDER BY c.changed_at DESC,c.id DESC LIMIT 1))
WHERE e.competition_division IS NULL;

CREATE OR REPLACE FUNCTION public.guard_ob_entry_division() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE chosen text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.competition_division IS NOT NULL THEN
    IF NEW.competition_division IS DISTINCT FROM OLD.competition_division
    THEN RAISE EXCEPTION 'entry_division_locked'; END IF;
    chosen := OLD.competition_division;
  ELSE
    chosen := COALESCE(NEW.competition_division,left(NEW.events[1],2));
  END IF;
  IF cardinality(NEW.events)>0 AND (chosen IS NULL OR chosen NOT IN ('男子','女子')
    OR EXISTS(SELECT 1 FROM unnest(NEW.events) x WHERE left(x,2)<>chosen))
  THEN RAISE EXCEPTION 'entry_division_mismatch'; END IF;
  NEW.competition_division := chosen;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_ob_entry_division() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ob_entry_division_guard ON public.ob_meet_entries;
CREATE TRIGGER ob_entry_division_guard BEFORE INSERT OR UPDATE ON public.ob_meet_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_ob_entry_division();
NOTIFY pgrst, 'reload schema';

-- Clearing a previous PB must not clear an independent UB (and vice versa).
-- Only explicitly newly selected flags, or a move to another user/event, win.
CREATE OR REPLACE FUNCTION public.pb_records_single_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claim_pb boolean; claim_ub boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    claim_pb := NEW.is_pb;
    claim_ub := NEW.is_ub;
  ELSE
    claim_pb := NEW.is_pb AND (NOT OLD.is_pb OR NEW.event_name IS DISTINCT FROM OLD.event_name OR NEW.user_id IS DISTINCT FROM OLD.user_id);
    claim_ub := NEW.is_ub AND (NOT OLD.is_ub OR NEW.event_name IS DISTINCT FROM OLD.event_name OR NEW.user_id IS DISTINCT FROM OLD.user_id);
  END IF;
  IF claim_pb THEN
    UPDATE public.pb_records SET is_pb = false
    WHERE user_id = NEW.user_id AND event_name = NEW.event_name AND id <> NEW.id AND is_pb;
  END IF;
  IF claim_ub THEN
    UPDATE public.pb_records SET is_ub = false
    WHERE user_id = NEW.user_id AND event_name = NEW.event_name AND id <> NEW.id AND is_ub;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS pb_records_single_flag_trigger ON public.pb_records;
CREATE TRIGGER pb_records_single_flag_trigger
AFTER INSERT OR UPDATE OF is_pb, is_ub, event_name, user_id ON public.pb_records
FOR EACH ROW WHEN (NEW.is_pb OR NEW.is_ub)
EXECUTE FUNCTION public.pb_records_single_flag();

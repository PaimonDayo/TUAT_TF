-- Copying existing entries is not a new user edit.
CREATE OR REPLACE FUNCTION public.log_ob_entry_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.is_mirror_write() THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  INSERT INTO public.ob_entry_changes(entry_id, actor_id, before_data, after_data)
  VALUES(NEW.id, auth.uid(), CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_ob_entry_change() FROM PUBLIC, anon, authenticated;

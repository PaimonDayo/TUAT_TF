CREATE TABLE IF NOT EXISTS public.competitions (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  starts_on date NOT NULL
);
INSERT INTO public.competitions(id,name,starts_on)
VALUES ('27-universities-2026','27大戦','2026-09-21') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competitions_read ON public.competitions;
CREATE POLICY competitions_read ON public.competitions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS competitions_update ON public.competitions;
CREATE POLICY competitions_update ON public.competitions FOR UPDATE TO authenticated
USING (public.can_manage_system()) WITH CHECK (public.can_manage_system());
GRANT SELECT, UPDATE ON public.competitions TO authenticated;

CREATE TABLE IF NOT EXISTS public.competition_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id text NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event = btrim(event) AND length(event) BETWEEN 1 AND 50),
  target text NOT NULL CHECK (length(btrim(target)) BETWEEN 1 AND 300),
  UNIQUE (competition_id,user_id,event)
);
ALTER TABLE public.competition_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_goals_read ON public.competition_goals;
CREATE POLICY competition_goals_read ON public.competition_goals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS competition_goals_insert ON public.competition_goals;
CREATE POLICY competition_goals_insert ON public.competition_goals FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid());
DROP POLICY IF EXISTS competition_goals_update ON public.competition_goals;
CREATE POLICY competition_goals_update ON public.competition_goals FOR UPDATE TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
DROP POLICY IF EXISTS competition_goals_delete ON public.competition_goals;
CREATE POLICY competition_goals_delete ON public.competition_goals FOR DELETE TO authenticated USING (user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.competition_goals TO authenticated;

CREATE TABLE IF NOT EXISTS public.note_article_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.note_articles(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' AND split_part(path,'/',1)=article_id::text)
);
CREATE INDEX IF NOT EXISTS note_article_images_article_idx ON public.note_article_images(article_id);
ALTER TABLE public.note_article_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_images_read ON public.note_article_images;
CREATE POLICY note_images_read ON public.note_article_images FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.note_articles a WHERE a.id=article_id AND public.can_view_note(a.note_id))
);
DROP POLICY IF EXISTS note_images_insert ON public.note_article_images;
CREATE POLICY note_images_insert ON public.note_article_images FOR INSERT TO authenticated WITH CHECK (
  created_by=auth.uid() AND EXISTS (SELECT 1 FROM public.note_articles a WHERE a.id=article_id AND public.can_edit_note(a.note_id))
);
DROP POLICY IF EXISTS note_images_delete ON public.note_article_images;
CREATE POLICY note_images_delete ON public.note_article_images FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.note_articles a WHERE a.id=article_id AND public.can_edit_note(a.note_id))
);
GRANT SELECT, INSERT, DELETE ON public.note_article_images TO authenticated;

CREATE OR REPLACE FUNCTION public.limit_note_images() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM id FROM public.note_articles WHERE id=NEW.article_id FOR UPDATE;
  IF (SELECT count(*) FROM public.note_article_images WHERE article_id=NEW.article_id)>=6 THEN
    RAISE EXCEPTION 'An article can have at most 6 photos';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS limit_note_images ON public.note_article_images;
CREATE TRIGGER limit_note_images BEFORE INSERT ON public.note_article_images FOR EACH ROW EXECUTE FUNCTION public.limit_note_images();

-- Durable cleanup survives article/folder cascade deletion and R2 outages.
CREATE TABLE IF NOT EXISTS public.note_image_cleanup (path text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.note_image_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.note_image_cleanup FROM anon,authenticated;
GRANT ALL ON public.note_image_cleanup TO service_role;
CREATE OR REPLACE FUNCTION public.queue_note_image_cleanup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.note_image_cleanup(path) VALUES(OLD.path) ON CONFLICT DO NOTHING;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS queue_note_image_cleanup ON public.note_article_images;
CREATE TRIGGER queue_note_image_cleanup AFTER DELETE ON public.note_article_images FOR EACH ROW EXECUTE FUNCTION public.queue_note_image_cleanup();
NOTIFY pgrst,'reload schema';

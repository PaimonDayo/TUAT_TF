\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database()<>'tuat_rls_review' OR EXISTS(SELECT 1 FROM auth.users)
     OR EXISTS(SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'Fresh empty synthetic database required';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO public.login_email_allowlist(email,created_by) VALUES
 ('backup-a@example.invalid','ba611111-0000-4000-8000-000000000001');
INSERT INTO auth.users(id,email) VALUES
 ('ba611111-0000-4000-8000-000000000001','backup-a@example.invalid'),
 ('ba611111-0000-4000-8000-000000000002','backup-b@example.invalid');
UPDATE public.profiles SET display_name='Synthetic backup A',avatar_url='ba611111-0000-4000-8000-000000000001/retired.webp'
 WHERE id='ba611111-0000-4000-8000-000000000001';
UPDATE public.profiles SET avatar_url='ba611111-0000-4000-8000-000000000001/current.webp'
 WHERE id='ba611111-0000-4000-8000-000000000001';
UPDATE public.profiles SET approved=false WHERE id='ba611111-0000-4000-8000-000000000002';
INSERT INTO public.notes(id,author_id,scope,title,body,status,edit_policy) VALUES
 ('ba611111-0000-4000-8100-000000000001','ba611111-0000-4000-8000-000000000001','personal','Synthetic restore note','body','draft','author');
INSERT INTO public.note_articles(id,note_id,author_id,title,body) VALUES
 ('ba611111-0000-4000-8200-000000000001','ba611111-0000-4000-8100-000000000001','ba611111-0000-4000-8000-000000000001','Synthetic article','body');
INSERT INTO public.note_article_images(id,article_id,path,created_by) VALUES
 ('ba611111-0000-4000-8300-000000000001','ba611111-0000-4000-8200-000000000001','ba611111-0000-4000-8200-000000000001/ba611111-0000-4000-8400-000000000001.webp','ba611111-0000-4000-8000-000000000001');
INSERT INTO public.note_image_cleanup(path) VALUES
 ('ba611111-0000-4000-8200-000000000001/ba611111-0000-4000-8400-000000000099.webp');
COMMIT;

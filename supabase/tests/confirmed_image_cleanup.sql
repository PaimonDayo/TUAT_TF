-- Fresh synthetic DB only; no R2 calls. All fixtures and duplicate DDL roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database() <> 'tuat_rls_review'
     OR EXISTS (SELECT 1 FROM public.profiles WHERE email !~ '@[^@]+\.invalid$') THEN
    RAISE EXCEPTION 'Use the fresh synthetic tuat_rls_review database';
  END IF;
END $$;
CREATE TEMP TABLE image_existing_acl AS
SELECT c.oid::regclass AS relation, role_name, permission,
  has_table_privilege(role_name,c.oid,permission) AS allowed
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) role_name
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) permission
WHERE n.nspname='public' AND c.relname IN ('profiles','note_article_images','note_image_cleanup');
\ir ../migrations/20261011150000_confirmed_image_cleanup.sql
\ir ../migrations/20261011150000_confirmed_image_cleanup.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM image_existing_acl a
    WHERE a.allowed IS DISTINCT FROM has_table_privilege(a.role_name,a.relation,a.permission)) THEN
    RAISE EXCEPTION 'Existing image/profile permissions changed';
  END IF;
  IF has_table_privilege('authenticated','public.confirmed_image_retirements','SELECT')
     OR has_table_privilege('anon','public.confirmed_image_retirements','SELECT')
     OR has_table_privilege('service_role','public.confirmed_image_retirements','UPDATE')
     OR has_function_privilege('authenticated','public.image_cleanup_lock(text,text,boolean)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_confirmed_image_cleanup(text,text)','EXECUTE')
     OR has_function_privilege('anon','public.avatar_image_is_retired(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_confirmed_image_cleanup(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Image cleanup privilege boundary failed';
  END IF;
END $$;
CREATE FUNCTION pg_temp.expect_image_rejection(statement text, expected_code text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_code THEN RAISE; END IF; rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Required image barrier did not reject'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO auth.users(id,email) VALUES
 ('e6101115-0000-4000-8000-000000000001','image-cleanup-a@example.invalid'),
 ('e6101115-0000-4000-8000-000000000002','image-cleanup-b@example.invalid');
INSERT INTO public.profiles(id,email,display_name,approved,status,avatar_url) VALUES
 ('e6101115-0000-4000-8000-000000000001','image-cleanup-a@example.invalid','Synthetic image A',true,'active','e6101115-0000-4000-8000-000000000001/old.webp'),
 ('e6101115-0000-4000-8000-000000000002','image-cleanup-b@example.invalid','Synthetic image B',true,'active',null)
ON CONFLICT(id) DO UPDATE SET avatar_url=EXCLUDED.avatar_url,approved=true,status='active';
INSERT INTO public.login_email_allowlist(email,created_by) VALUES
 ('image-cleanup-a@example.invalid','e6101115-0000-4000-8000-000000000001'),
 ('image-cleanup-b@example.invalid','e6101115-0000-4000-8000-000000000002');
INSERT INTO public.notes(id,author_id,scope,title,body,status,edit_policy) VALUES
 ('e6101115-0000-4000-8100-000000000001','e6101115-0000-4000-8000-000000000001','personal','Synthetic image note','','draft','author');
INSERT INTO public.note_articles(id,note_id,author_id,title,body) VALUES
 ('e6101115-0000-4000-8200-000000000001','e6101115-0000-4000-8100-000000000001','e6101115-0000-4000-8000-000000000001','Synthetic article',''),
 ('e6101115-0000-4000-8200-000000000002','e6101115-0000-4000-8100-000000000001','e6101115-0000-4000-8000-000000000001','Synthetic cascade article','');
INSERT INTO public.note_article_images(id,article_id,path,created_by) VALUES
 ('e6101115-0000-4000-8300-000000000001','e6101115-0000-4000-8200-000000000001','e6101115-0000-4000-8200-000000000001/e6101115-0000-4000-8400-000000000001.webp','e6101115-0000-4000-8000-000000000001'),
 ('e6101115-0000-4000-8300-000000000002','e6101115-0000-4000-8200-000000000002','e6101115-0000-4000-8200-000000000002/e6101115-0000-4000-8400-000000000002.webp','e6101115-0000-4000-8000-000000000001');
INSERT INTO public.note_image_cleanup(path) VALUES
 ('e6101115-0000-4000-8200-000000000001/e6101115-0000-4000-8400-000000000099.webp');
CREATE TEMP TABLE image_legacy_before AS SELECT * FROM public.note_image_cleanup;

-- Calling the new definer RPC directly must not bypass withdrawal/approval.
UPDATE public.profiles SET approved=false WHERE id='e6101115-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.headers','{}',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"e6101115-0000-4000-8000-000000000002","email":"image-cleanup-b@example.invalid"}',true);
SELECT pg_temp.expect_image_rejection($s$SELECT public.avatar_image_is_retired('e6101115-0000-4000-8000-000000000001/old.webp')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
UPDATE public.profiles SET approved=true WHERE id='e6101115-0000-4000-8000-000000000002';
DELETE FROM public.login_email_allowlist WHERE email='image-cleanup-a@example.invalid';
SET LOCAL ROLE authenticated;
SELECT set_config('request.headers','{}',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"e6101115-0000-4000-8000-000000000001","email":"image-cleanup-a@example.invalid"}',true);
SELECT pg_temp.expect_image_rejection($s$SELECT public.avatar_image_is_retired('e6101115-0000-4000-8000-000000000001/old.webp')$s$,'42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO public.login_email_allowlist(email,created_by) VALUES('image-cleanup-a@example.invalid','e6101115-0000-4000-8000-000000000001');

-- A DB error after unlink rolls back both reference and confirmation.
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET avatar_url=null WHERE id='e6101115-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Synthetic failure after unlink' USING ERRCODE='22000';
  EXCEPTION WHEN data_exception THEN NULL;
  END;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='e6101115-0000-4000-8000-000000000001' AND avatar_url IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.confirmed_image_retirements WHERE path='e6101115-0000-4000-8000-000000000001/old.webp' AND confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Rollback lost a reference or retained a false confirmation';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.headers','{}',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"e6101115-0000-4000-8000-000000000001","email":"image-cleanup-a@example.invalid"}',true);
UPDATE public.profiles SET avatar_url=null WHERE id='e6101115-0000-4000-8000-000000000001';
SELECT pg_temp.expect_image_rejection($s$UPDATE public.profiles SET avatar_url='e6101115-0000-4000-8000-000000000001/old.webp' WHERE id='e6101115-0000-4000-8000-000000000001'$s$,'PT409');
SELECT pg_temp.expect_image_rejection($s$UPDATE public.profiles SET avatar_url='https://synthetic.invalid/storage/v1/object/public/avatars/e6101115-0000-4000-8000-000000000001/%6Fld.webp' WHERE id='e6101115-0000-4000-8000-000000000001'$s$,'PT409');
UPDATE public.profiles SET display_name='Synthetic ordinary edit still allowed' WHERE id='e6101115-0000-4000-8000-000000000001';
DELETE FROM public.note_article_images WHERE id='e6101115-0000-4000-8300-000000000001';
SELECT pg_temp.expect_image_rejection($s$INSERT INTO public.note_article_images(article_id,path,created_by) VALUES('e6101115-0000-4000-8200-000000000001','e6101115-0000-4000-8200-000000000001/e6101115-0000-4000-8400-000000000001.webp','e6101115-0000-4000-8000-000000000001')$s$,'PT409');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
-- A service/cascade path receives the same terminal barrier, without a bypass.
DELETE FROM public.note_articles WHERE id='e6101115-0000-4000-8200-000000000002';
DO $$ DECLARE claim jsonb; BEGIN
  IF EXISTS (SELECT * FROM image_legacy_before EXCEPT SELECT * FROM public.note_image_cleanup) THEN
    RAISE EXCEPTION 'Legacy queue was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.confirmed_image_retirements WHERE path='e6101115-0000-4000-8200-000000000001/e6101115-0000-4000-8400-000000000099.webp') THEN
    RAISE EXCEPTION 'Legacy unknown queue was promoted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.confirmed_image_retirements WHERE bucket='note-images' AND path='e6101115-0000-4000-8200-000000000002/e6101115-0000-4000-8400-000000000002.webp' AND confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cascade deletion did not confirm its image';
  END IF;
  claim := public.claim_confirmed_image_cleanup('avatars','e6101115-0000-4000-8000-000000000001/old.webp');
  IF claim IS NULL OR (claim->>'delete_after')::timestamptz < (claim->>'closed_at')::timestamptz + interval '7 days 10 minutes'
     OR public.finish_confirmed_image_cleanup('avatars','e6101115-0000-4000-8000-000000000001/old.webp',(claim->>'closed_at')::timestamptz) THEN
    RAISE EXCEPTION 'Signature/cache retention was bypassed';
  END IF;
END $$;
-- Shared legacy references prevent confirmation until their last unlink.
UPDATE public.profiles SET avatar_url='e6101115-0000-4000-8000-000000000001/shared.webp' WHERE id IN ('e6101115-0000-4000-8000-000000000001','e6101115-0000-4000-8000-000000000002');
UPDATE public.profiles SET avatar_url=null WHERE id='e6101115-0000-4000-8000-000000000001';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"e6101115-0000-4000-8000-000000000001","email":"image-cleanup-a@example.invalid"}',true);
  IF public.avatar_image_is_retired('e6101115-0000-4000-8000-000000000001/shared.webp')
     OR public.claim_confirmed_image_cleanup('avatars','e6101115-0000-4000-8000-000000000001/shared.webp') IS NOT NULL THEN
    RAISE EXCEPTION 'Still-referenced shared image was retired';
  END IF;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
END $$;
UPDATE public.profiles SET avatar_url=null WHERE id='e6101115-0000-4000-8000-000000000002';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"e6101115-0000-4000-8000-000000000001","email":"image-cleanup-a@example.invalid"}',true);
  IF NOT EXISTS (SELECT 1 FROM public.confirmed_image_retirements WHERE path='e6101115-0000-4000-8000-000000000001/shared.webp' AND confirmed_at IS NOT NULL)
     OR public.avatar_image_is_retired('e6101115-0000-4000-8000-000000000001/shared.webp') THEN
    RAISE EXCEPTION 'Last shared unlink did not confirm without closing';
  END IF;
  PERFORM public.claim_confirmed_image_cleanup('avatars','e6101115-0000-4000-8000-000000000001/shared.webp');
  IF NOT public.avatar_image_is_retired('e6101115-0000-4000-8000-000000000001/shared.webp') THEN
    RAISE EXCEPTION 'Atomic zero-reference closure did not stop signing';
  END IF;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
END $$;
ROLLBACK;
\echo 'PASS: confirmed-only image barrier, rollback, permissions, aliases, shared refs, cascade, retention and legacy quarantine'

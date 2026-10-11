\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database()<>'tuat_rls_review' OR EXISTS(SELECT 1 FROM auth.users)
     OR EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM public.sheet_push_attempts)
     OR EXISTS(SELECT 1 FROM public.sheet_pending_clears) THEN
    RAISE EXCEPTION 'Fresh empty synthetic database required';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO public.login_email_allowlist(email,created_by) VALUES
 ('backup-a@example.invalid','ba611111-0000-4000-8000-000000000001'),
 ('backup-c@example.invalid','ba611111-0000-4000-8000-000000000003');
INSERT INTO auth.users(id,email) VALUES
 ('ba611111-0000-4000-8000-000000000001','backup-a@example.invalid'),
 ('ba611111-0000-4000-8000-000000000002','backup-b@example.invalid'),
 ('ba611111-0000-4000-8000-000000000003','backup-c@example.invalid');
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

-- Build durable external-write evidence through the actual service-only RPCs.
-- No provider or payload bytes exist: these hashes bind synthetic metadata only.
CREATE FUNCTION pg_temp.backup_uuid(family text,n integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('ba611111-0000-4000-'||family||'-'||lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.backup_sha(value text) RETURNS text LANGUAGE sql AS $$
 SELECT md5('backup-a:'||value)||md5('backup-b:'||value);
$$;
CREATE FUNCTION pg_temp.backup_sheet_config(profile uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('sheet_name',sheet_name,'record_fields',record_fields,
   'sheet_transition',sheet_transition,'sheet_header_signature',sheet_header_signature,'record_source',record_source)
 FROM public.profiles WHERE id=profile;
$$;
CREATE FUNCTION pg_temp.backup_assert(ok boolean) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Synthetic backup receipt fixture mismatch'; END IF; END;
$$;
CREATE FUNCTION pg_temp.backup_begin(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.sheet_push_begin(pg_temp.backup_uuid('8600',n),'record',r.id,r.user_id,r.recorded_date,r.updated_at,
   pg_temp.backup_sheet_config(r.user_id),pg_temp.backup_sha('slot-'||n),pg_temp.backup_sha('target-'||n),pg_temp.backup_sha('payload-'||n))
 FROM public.practice_records r WHERE r.id=pg_temp.backup_uuid('8500',n);
$$;
UPDATE public.profiles SET sheet_name='Synthetic backup workbook',record_fields='[{"key":"memo","header":"Synthetic memo"}]',
 sheet_transition='{"version":"2026-10","mode":"sheet"}',sheet_header_signature='synthetic-backup-header',record_source='sheet'
 WHERE id IN(pg_temp.backup_uuid('8000',1),pg_temp.backup_uuid('8000',3));
INSERT INTO public.practice_records(id,user_id,recorded_date,memo,updated_at,pending_sheet_push,from_sheet)
 SELECT pg_temp.backup_uuid('8500',n),pg_temp.backup_uuid('8000',1),DATE '2099-01-01'+n,'Synthetic backup record '||n,
   TIMESTAMPTZ '2026-10-11 01:00:00Z',true,false FROM generate_series(1,5) n;
INSERT INTO public.practice_records(id,user_id,recorded_date,memo,updated_at,pending_sheet_push,from_sheet)
 VALUES(pg_temp.backup_uuid('8500',6),pg_temp.backup_uuid('8000',3),DATE '2099-01-02','Synthetic same-day cross-profile target',
   TIMESTAMPTZ '2026-10-11 01:00:00Z',true,false);
SELECT set_config('request.headers','{}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.backup_assert(pg_temp.backup_begin(1)->>'outcome'='send');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(2)->>'outcome'='send');
SELECT pg_temp.backup_assert(public.sheet_push_finish(pg_temp.backup_uuid('8600',2),pg_temp.backup_sha('target-2'),pg_temp.backup_sha('payload-2'),false)
 @> '{"outcome":"confirmed","marker_status":"partial"}');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(3)->>'outcome'='send');
SELECT pg_temp.backup_assert(public.sheet_push_finish(pg_temp.backup_uuid('8600',3),pg_temp.backup_sha('target-3'),pg_temp.backup_sha('payload-3'),true)
 @> '{"outcome":"completed","marker_status":"applied"}');
SELECT pg_temp.backup_assert(pg_temp.backup_begin(4)->>'outcome'='send');
RESET ROLE;
UPDATE public.sheet_push_attempts SET created_at=TIMESTAMPTZ '1900-01-01' WHERE attempt_id=pg_temp.backup_uuid('8600',1);
UPDATE public.practice_records SET memo='Synthetic newer unknown edit' WHERE id=pg_temp.backup_uuid('8500',1);
UPDATE public.practice_records SET memo='Synthetic newer superseded edit' WHERE id=pg_temp.backup_uuid('8500',4);
SET LOCAL ROLE service_role;
SELECT pg_temp.backup_assert(public.sheet_push_finish(pg_temp.backup_uuid('8600',4),pg_temp.backup_sha('target-4'),pg_temp.backup_sha('payload-4'),true)
 @> '{"outcome":"completed","marker_status":"superseded"}');
DELETE FROM public.practice_records WHERE id=pg_temp.backup_uuid('8500',5);
SELECT pg_temp.backup_assert(public.sheet_push_begin(pg_temp.backup_uuid('8600',5),'clear',NULL,pg_temp.backup_uuid('8000',1),DATE '2099-01-06',
 (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.backup_uuid('8000',1) AND recorded_date=DATE '2099-01-06'),
 pg_temp.backup_sheet_config(pg_temp.backup_uuid('8000',1)),pg_temp.backup_sha('slot-5'),pg_temp.backup_sha('target-5'),pg_temp.backup_sha('payload-5'))->>'outcome'='send');
SELECT pg_temp.backup_assert((SELECT count(*) FROM public.sheet_push_attempts)=5);
RESET ROLE;
COMMIT;

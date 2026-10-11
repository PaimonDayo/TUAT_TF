\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database()<>'tuat_rls_review' OR EXISTS(SELECT 1 FROM auth.users)
     OR EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM public.sheet_push_attempts)
     OR EXISTS(SELECT 1 FROM public.sheet_pending_clears)
     OR EXISTS(SELECT 1 FROM public.google_sheet_creation_attempts) THEN
    RAISE EXCEPTION 'Fresh empty synthetic database required';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO public.login_email_allowlist(email,created_by) VALUES
 ('backup-a@example.invalid','ba611111-0000-4000-8000-000000000001'),
 ('backup-c@example.invalid','ba611111-0000-4000-8000-000000000003'),
 ('backup-d@example.invalid','ba611111-0000-4000-8000-000000000004'),
 ('backup-e@example.invalid','ba611111-0000-4000-8000-000000000005');
INSERT INTO auth.users(id,email) VALUES
 ('ba611111-0000-4000-8000-000000000001','backup-a@example.invalid'),
 ('ba611111-0000-4000-8000-000000000002','backup-b@example.invalid'),
 ('ba611111-0000-4000-8000-000000000003','backup-c@example.invalid'),
 ('ba611111-0000-4000-8000-000000000004','backup-d@example.invalid'),
 ('ba611111-0000-4000-8000-000000000005','backup-e@example.invalid');
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

-- Four independent creation states using the real authenticated/service RPCs.
-- The encrypted token placeholder is never decrypted or sent to Google.
INSERT INTO public.profile_roles(profile_id,role_id)
 SELECT pg_temp.backup_uuid('8000',n),r.id FROM unnest(ARRAY[1,3,4,5]) n
 CROSS JOIN (SELECT id FROM public.roles WHERE can_create_schedule AND NOT is_everyone ORDER BY id LIMIT 1) r
 ON CONFLICT DO NOTHING;
INSERT INTO public.google_drive_connections(profile_id,refresh_token_encrypted,connected_at)
 SELECT pg_temp.backup_uuid('8000',n),'synthetic-ciphertext',TIMESTAMPTZ '2026-10-11T00:00:00Z'
 FROM unnest(ARRAY[1,3,4,5]) n;
CREATE FUNCTION pg_temp.backup_creation_begin(n integer,attempt integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.google_sheet_creation_begin(pg_temp.backup_uuid('8700',attempt),TIMESTAMPTZ '2026-10-11T00:00:00Z',
  encode(digest('synthetic-ciphertext','sha256'),'hex'),repeat(chr(96+n),64),
  '{"kind":"practice","block":"all","year":2026,"month":11}'::jsonb);
$$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer;actor integer;letter text; BEGIN
 FOR n IN 1..4 LOOP
  actor:=CASE WHEN n=1 THEN 1 ELSE n+1 END; letter:=chr(96+actor);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.backup_uuid('8000',actor),'email','backup-'||letter||'@example.invalid')::text,true);
  PERFORM pg_temp.backup_assert(pg_temp.backup_creation_begin(n,n)->>'outcome'='send');
 END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.backup_assert(public.google_sheet_creation_resource(pg_temp.backup_uuid('8700',n),pg_temp.backup_uuid('8000',n+1),'synthetic_google_book_'||n)->>'outcome'='known')
 FROM generate_series(2,4) n;
SELECT pg_temp.backup_assert(public.google_sheet_creation_setup(pg_temp.backup_uuid('8700',n),pg_temp.backup_uuid('8000',n+1),'synthetic_google_book_'||n)->>'setup_confirmed'='true')
 FROM generate_series(3,4) n;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"ba611111-0000-4000-8000-000000000004","email":"backup-d@example.invalid"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.backup_assert(public.google_sheet_creation_register(pg_temp.backup_uuid('8700',3)) @> '{"outcome":"registered","record_status":"present"}');
RESET ROLE;
UPDATE public.google_sheet_creation_attempts SET created_at=TIMESTAMPTZ '1900-01-01' WHERE attempt_id=pg_temp.backup_uuid('8700',1);
SELECT pg_temp.backup_assert((SELECT count(*) FROM public.google_sheet_creation_attempts)=4);
COMMIT;

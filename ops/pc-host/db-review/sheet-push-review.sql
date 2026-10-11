-- Fresh, unpublished owner-labelled synthetic PostgreSQL only; no GAS/provider.
-- All assertions/fixtures, including migration reapply, roll back together.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
  IF current_database()<>'tuat_rls_review' OR EXISTS(SELECT 1 FROM public.profiles)
    OR EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.sheet_push_attempts)
    OR EXISTS(SELECT 1 FROM public.sheet_pending_clears) THEN
    RAISE EXCEPTION 'Fresh empty synthetic tuat_rls_review required';
  END IF;
END $$;

CREATE FUNCTION pg_temp.assert_sheet(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Sheet receipt assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.sheet_config(profile uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('sheet_name',sheet_name,'record_fields',record_fields,
   'sheet_transition',sheet_transition,'sheet_header_signature',sheet_header_signature,'record_source',record_source)
 FROM public.profiles WHERE id=profile;
$$;
CREATE FUNCTION pg_temp.sheet_uuid(family text,n integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('f6101117-0000-4000-'||family||'-'||lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION pg_temp.sheet_sha(value text) RETURNS text LANGUAGE sql AS $$
 SELECT md5('fixture-a:'||value)||md5('fixture-b:'||value);
$$;
CREATE FUNCTION pg_temp.record_begin(n integer,attempt integer,expected timestamptz DEFAULT NULL,
  cfg jsonb DEFAULT NULL,slot text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.sheet_push_begin(pg_temp.sheet_uuid('8200',attempt),'record',r.id,r.user_id,r.recorded_date,
   coalesce(expected,r.updated_at),coalesce(cfg,pg_temp.sheet_config(r.user_id)),
   coalesce(slot,pg_temp.sheet_sha('slot-'||n)),pg_temp.sheet_sha('target-'||n),pg_temp.sheet_sha('payload-'||n))
 FROM public.practice_records r WHERE r.id=pg_temp.sheet_uuid('8100',n);
$$;
CREATE FUNCTION pg_temp.record_finish(n integer,attempt integer,complete boolean) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.sheet_push_finish(pg_temp.sheet_uuid('8200',attempt),pg_temp.sheet_sha('target-'||n),pg_temp.sheet_sha('payload-'||n),complete);
$$;
CREATE FUNCTION pg_temp.finish_must_not_confirm(attempt uuid,target text,payload text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE answer jsonb; BEGIN
  BEGIN answer:=public.sheet_push_finish(attempt,target,payload,true);
  EXCEPTION WHEN OTHERS THEN RETURN; END;
  IF answer->>'outcome' IN ('confirmed','completed') THEN RAISE EXCEPTION 'Mismatched proof accepted provider success'; END IF;
END $$;
CREATE FUNCTION pg_temp.sheet_expect_sqlstate(statement text,code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false; BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>code THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Required sheet receipt rejection did not occur: %',code; END IF;
END $$;

-- Existing permissions are recorded; migration reapply must preserve them.
CREATE TEMP TABLE sheet_existing_acl AS
 SELECT c.oid::regclass AS relation,role_name,permission,has_table_privilege(role_name,c.oid,permission) AS allowed
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) role_name
 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) permission
 WHERE n.nspname='public' AND c.relname IN ('profiles','practice_records','sheet_pending_clears');
DO $$ DECLARE role_name text;signature text; BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sheet_push_attempts'::regclass) THEN
    RAISE EXCEPTION 'Attempt receipts lack RLS';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name,'public.sheet_push_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'Member/anonymous direct receipt table privilege';
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'public.sheet_push_begin(uuid,text,uuid,uuid,date,timestamp with time zone,jsonb,text,text,text)',
    'public.sheet_push_finish(uuid,text,text,boolean)',
    'public.sheet_clear_resolve(uuid,date,timestamp with time zone,jsonb,text)'] LOOP
    IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('authenticated',signature,'EXECUTE')
      OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Receipt RPC privilege boundary'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.sheet_push_attempts'::regclass AND contype='f' AND confdeltype='c') THEN
    RAISE EXCEPTION 'Attempt receipts can be cascade deleted';
  END IF;
  IF has_table_privilege('service_role','public.sheet_push_attempts','INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'Service role bypasses receipt RPC mutation boundary';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.headers','{"x-tuat-mirror":"1"}',true);
INSERT INTO auth.users(id,email) VALUES
 (pg_temp.sheet_uuid('8000',1),'sheet-receipt@example.invalid'),
 (pg_temp.sheet_uuid('8000',2),'sheet-receipt-two@example.invalid');
INSERT INTO public.login_email_allowlist(email,created_by) VALUES
 ('sheet-receipt@example.invalid',pg_temp.sheet_uuid('8000',1)),
 ('sheet-receipt-two@example.invalid',pg_temp.sheet_uuid('8000',2));
UPDATE public.profiles SET sheet_name='Synthetic workbook',record_fields='[{"key":"memo","header":"Synthetic memo"}]',
 sheet_transition='{"version":"2026-10","mode":"sheet"}',sheet_header_signature='synthetic-header',record_source='sheet'
 WHERE id IN(pg_temp.sheet_uuid('8000',1),pg_temp.sheet_uuid('8000',2));
INSERT INTO public.practice_records(id,user_id,recorded_date,memo,updated_at,pending_sheet_push,from_sheet)
 SELECT pg_temp.sheet_uuid('8100',n),pg_temp.sheet_uuid('8000',1),DATE '2099-01-01'+n,'synthetic-'||n,
   TIMESTAMPTZ '2026-10-11 01:00:00Z',true,false FROM generate_series(1,18) n;
SELECT set_config('request.headers','{}',true);

-- Exercise service-only execution under the actual SQL role, not owner grants.
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_sheet(pg_temp.record_begin(1,1)->>'outcome'='send','first reservation sends');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(1,2)->>'outcome'='blocked','one active reservation per record');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(1,1)->>'outcome'<>'send','same reserved attempt never redispatches');
RESET ROLE;
DO $$ DECLARE role_name text; rejected boolean; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE 'SET LOCAL ROLE '||quote_ident(role_name);
    rejected:=false;
    BEGIN PERFORM public.sheet_push_finish(pg_temp.sheet_uuid('8200',1),pg_temp.sheet_sha('target-1'),pg_temp.sheet_sha('payload-1'),true);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unprivileged finish executed'; END IF;
    rejected:=false;
    BEGIN PERFORM pg_temp.record_begin(2,100);
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unprivileged begin executed'; END IF;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- Wrong record version/raw five-key profile config cannot reserve or send.
SELECT pg_temp.assert_sheet(pg_temp.record_begin(2,3,TIMESTAMPTZ '2026-10-11 01:00:01Z')->>'outcome'='stale','record version bound');
DO $$ DECLARE column_name text;cfg jsonb;answer jsonb;before_count bigint; BEGIN
  SELECT count(*) INTO before_count FROM public.sheet_push_attempts;
  FOREACH column_name IN ARRAY ARRAY['sheet_name','record_fields','sheet_transition','sheet_header_signature','record_source'] LOOP
    cfg:=pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1));
    cfg:=jsonb_set(cfg,ARRAY[column_name],CASE column_name WHEN 'record_fields' THEN '[]'::jsonb
      WHEN 'sheet_transition' THEN 'null'::jsonb ELSE to_jsonb('raw changed '||column_name) END);
    answer:=pg_temp.record_begin(2,4,NULL,cfg);
    IF answer->>'outcome'<>'stale' THEN RAISE EXCEPTION 'Raw profile key mismatch accepted: %',column_name; END IF;
  END LOOP;
  FOREACH column_name IN ARRAY ARRAY['sheet_name','record_fields','sheet_transition','sheet_header_signature','record_source'] LOOP
    answer:=pg_temp.record_begin(2,4,NULL,pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1))-column_name);
    IF answer->>'outcome'<>'stale' THEN RAISE EXCEPTION 'Missing raw profile key accepted: %',column_name; END IF;
  END LOOP;
  cfg:=pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1));
  answer:=pg_temp.record_begin(2,4,NULL,jsonb_set(cfg,'{sheet_name}',to_jsonb(' Synthetic workbook '::text)));
  IF answer->>'outcome'<>'stale' OR (SELECT count(*) FROM public.sheet_push_attempts)<>before_count THEN
    RAISE EXCEPTION 'Trimmed config or stale input created a receipt';
  END IF;
END $$;
SELECT pg_temp.assert_sheet(pg_temp.record_begin(2,5,NULL,NULL,pg_temp.sheet_sha('slot-1'))->>'outcome'='blocked','same target slot reserved across records');
UPDATE public.profiles SET sheet_transition=NULL,sheet_header_signature=NULL WHERE id=pg_temp.sheet_uuid('8000',1);
SELECT pg_temp.assert_sheet(pg_temp.record_begin(17,117,NULL,pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1))-'sheet_header_signature')->>'outcome'='stale',
 'JSON null differs from a missing raw profile key');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(17,118)->>'outcome'='send','exact five keys including JSON null reserve');
UPDATE public.profiles SET sheet_transition='{"version":"2026-10","mode":"sheet"}',sheet_header_signature='synthetic-header' WHERE id=pg_temp.sheet_uuid('8000',1);

-- Unknown/crash and age never expire a reservation; edits/deletes retain it.
UPDATE public.sheet_push_attempts SET created_at=TIMESTAMPTZ '1900-01-01' WHERE record_id=pg_temp.sheet_uuid('8100',1);
SELECT pg_temp.assert_sheet(pg_temp.record_begin(1,6)->>'outcome'='blocked','no timeout takeover');
UPDATE public.practice_records SET memo='synthetic edited while unknown' WHERE id=pg_temp.sheet_uuid('8100',1);
SELECT pg_temp.assert_sheet(pg_temp.record_begin(1,7)->>'outcome'='blocked','edit does not release unknown reservation');
DELETE FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',1);
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE record_id=pg_temp.sheet_uuid('8100',1) AND state='reserved'),
  'record deletion retains durable unknown receipt');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-02'),
  'deleted unknown record retains clear/CSV barrier');
SELECT pg_temp.assert_sheet(public.sheet_clear_resolve(pg_temp.sheet_uuid('8000',1),DATE '2099-01-02',
  (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-02'),
  pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('slot-1'))->>'outcome'='blocked','active receipt blocks no-provider clear resolution');
SELECT pg_temp.assert_sheet(public.sheet_push_begin(pg_temp.sheet_uuid('8200',8),'clear',NULL,pg_temp.sheet_uuid('8000',1),DATE '2099-01-02',
  (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-02'),
  pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('clear-held-slot'),pg_temp.sheet_sha('clear-held-target'),pg_temp.sheet_sha('clear-held-payload'))->>'outcome'='blocked',
  'profile/date barrier survives deleted record ID and changed target');
SET LOCAL ROLE service_role;
SELECT pg_temp.sheet_expect_sqlstate($s$DELETE FROM public.sheet_pending_clears WHERE user_id='f6101117-0000-4000-8000-000000000001' AND recorded_date=DATE '2099-01-02'$s$,'PT409');
SELECT pg_temp.sheet_expect_sqlstate($s$INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet,synced_at)
 VALUES('f6101117-0000-4000-8100-000000000101','f6101117-0000-4000-8000-000000000001',DATE '2099-01-02','synthetic CSV resurrection',true,clock_timestamp())$s$,'PT409');
RESET ROLE;

INSERT INTO public.practice_records(id,user_id,recorded_date,memo,pending_sheet_push,from_sheet)
 VALUES(pg_temp.sheet_uuid('8100',302),pg_temp.sheet_uuid('8000',2),DATE '2099-02-01','synthetic other profile recreation',true,false);
INSERT INTO public.sheet_pending_clears(user_id,recorded_date) VALUES(pg_temp.sheet_uuid('8000',2),DATE '2099-02-01');
SELECT pg_temp.assert_sheet(public.sheet_clear_resolve(pg_temp.sheet_uuid('8000',2),DATE '2099-02-01',
 (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',2) AND recorded_date=DATE '2099-02-01'),
 pg_temp.sheet_config(pg_temp.sheet_uuid('8000',2)),pg_temp.sheet_sha('slot-1'))->>'outcome'='blocked',
 'another profile active physical slot blocks no-provider clear resolution');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',2) AND recorded_date=DATE '2099-02-01'),
 'cross-profile physical-slot barrier preserves queue');

SELECT pg_temp.assert_sheet(pg_temp.record_begin(18,218)->>'outcome'='send','unknown moved-date fixture reserves');
UPDATE public.practice_records SET recorded_date=DATE '2100-01-18' WHERE id=pg_temp.sheet_uuid('8100',18);
SELECT pg_temp.assert_sheet(pg_temp.record_begin(18,219)->>'outcome'='blocked','moving date does not release active record receipt');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE record_id=pg_temp.sheet_uuid('8100',18)
 AND state='reserved' AND recorded_date=DATE '2099-01-19'),'active receipt retains original date proof after date change');
SELECT pg_temp.sheet_expect_sqlstate($s$INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet,synced_at)
 VALUES('f6101117-0000-4000-8100-000000000218','f6101117-0000-4000-8000-000000000001',DATE '2099-01-19','synthetic CSV old date',true,clock_timestamp())$s$,'PT409');

-- Fingerprint/payload mismatch cannot confirm. Partial success remains a hold.
SELECT pg_temp.assert_sheet(pg_temp.record_begin(3,9)->>'outcome'='send','proof fixture sends once');
SELECT pg_temp.finish_must_not_confirm(pg_temp.sheet_uuid('8200',9),pg_temp.sheet_sha('wrong-target'),pg_temp.sheet_sha('payload-3'));
SELECT pg_temp.finish_must_not_confirm(pg_temp.sheet_uuid('8200',9),pg_temp.sheet_sha('target-3'),pg_temp.sheet_sha('wrong-payload'));
SELECT pg_temp.assert_sheet((SELECT pending_sheet_push AND synced_at IS NULL FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',3)),
  'mismatched finish leaves record pending');
SELECT pg_temp.assert_sheet(pg_temp.record_finish(3,9,false) @> '{"outcome":"confirmed","marker_status":"partial"}', 'partial evidence confirmed but not completed');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE record_id=pg_temp.sheet_uuid('8100',3) AND state='confirmed' AND marker_status='partial'),
  'partial receipt remains durable confirmed barrier');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(3,10)->>'outcome'='blocked','partial provider outcome cannot redispatch');
SELECT pg_temp.assert_sheet((SELECT pending_sheet_push AND synced_at IS NULL FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',3)),
  'partial provider outcome cannot acknowledge app record');
SELECT pg_temp.assert_sheet(pg_temp.record_finish(3,9,true) @> '{"outcome":"confirmed","marker_status":"partial"}',
  'a partial provider outcome cannot later be upgraded');
SELECT pg_temp.sheet_expect_sqlstate($s$UPDATE public.practice_records SET memo='synthetic CSV overwrite',synced_at=clock_timestamp(),from_sheet=true,pending_sheet_push=false
 WHERE id='f6101117-0000-4000-8100-000000000003'$s$,'PT409');

-- Known complete success and marker update commit atomically and are idempotent.
SELECT pg_temp.assert_sheet(pg_temp.record_begin(4,11)->>'outcome'='send','complete fixture begins');
DO $$ BEGIN
  BEGIN
    PERFORM pg_temp.record_finish(4,11,true);
    RAISE EXCEPTION 'Synthetic failure after provider receipt' USING ERRCODE='22000';
  EXCEPTION WHEN data_exception THEN NULL; END;
  IF NOT (SELECT pending_sheet_push AND synced_at IS NULL FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',4))
    OR NOT EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE record_id=pg_temp.sheet_uuid('8100',4) AND state='reserved') THEN
    RAISE EXCEPTION 'Receipt/marker partial commit survived rollback';
  END IF;
END $$;
SELECT pg_temp.assert_sheet(pg_temp.record_finish(4,11,true) @> '{"outcome":"completed","marker_status":"applied"}','known full success applies CAS marker');
SELECT pg_temp.assert_sheet((SELECT NOT pending_sheet_push AND synced_at IS NOT NULL FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',4)),
  'known success clears only matching pending version');
SELECT pg_temp.assert_sheet(pg_temp.record_finish(4,11,true) @> '{"outcome":"completed","marker_status":"applied"}','finish idempotence');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_push_attempts a JOIN public.practice_records r ON r.id=a.record_id
 WHERE a.record_id=pg_temp.sheet_uuid('8100',4) AND a.marker_version=r.updated_at AND a.marker_version<>a.expected_version
 AND a.expected_profile=pg_temp.sheet_config(r.user_id) AND a.target_slot=pg_temp.sheet_sha('slot-4')
 AND a.target_fingerprint=pg_temp.sheet_sha('target-4') AND a.payload_sha256=pg_temp.sheet_sha('payload-4')
 AND a.profile_fingerprint=encode(sha256(convert_to(a.expected_profile::text,'UTF8')),'hex')),
 'marker version stores actual touched timestamp and complete proof binding');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(4,111)->>'outcome'='completed','fresh begin at actual marker version never redispatches');
UPDATE public.practice_records SET memo='synthetic true edit after known completion' WHERE id=pg_temp.sheet_uuid('8100',4);
SELECT pg_temp.assert_sheet(public.sheet_push_begin(pg_temp.sheet_uuid('8200',112),'record',pg_temp.sheet_uuid('8100',4),pg_temp.sheet_uuid('8000',1),DATE '2099-01-05',
 (SELECT updated_at FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',4)),pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),
 pg_temp.sheet_sha('slot-4'),pg_temp.sheet_sha('target-4'),pg_temp.sheet_sha('payload-4-new'))->>'outcome'='send','true later edit can reserve after old known completion');

-- An actual marker trigger failure rolls the receipt back, not only caller work.
SELECT pg_temp.assert_sheet(pg_temp.record_begin(15,115)->>'outcome'='send','marker-failure fixture begins');
CREATE FUNCTION pg_temp.sheet_fail_marker() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Synthetic marker trigger failure' USING ERRCODE='22000';
END $$;
CREATE TRIGGER zz_synthetic_sheet_marker_failure BEFORE UPDATE OF synced_at ON public.practice_records
 FOR EACH ROW WHEN (OLD.id='f6101117-0000-4000-8100-000000000015'::uuid) EXECUTE FUNCTION pg_temp.sheet_fail_marker();
SELECT pg_temp.sheet_expect_sqlstate($s$SELECT pg_temp.record_finish(15,115,true)$s$,'22000');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_push_attempts WHERE record_id=pg_temp.sheet_uuid('8100',15) AND state='reserved')
 AND (SELECT pending_sheet_push AND synced_at IS NULL FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',15)),
 'marker trigger failure retains reserved receipt and pending record');
DROP TRIGGER zz_synthetic_sheet_marker_failure ON public.practice_records;

-- A receipt for an older version/config/date does not consume a newer edit.
SELECT pg_temp.assert_sheet(pg_temp.record_begin(5,12)->>'outcome'='send','older version begins');
UPDATE public.practice_records SET memo='synthetic newer pending edit' WHERE id=pg_temp.sheet_uuid('8100',5);
SELECT pg_temp.assert_sheet(pg_temp.record_finish(5,12,true) @> '{"outcome":"completed","marker_status":"superseded"}','old version receipt superseded');
SELECT pg_temp.assert_sheet((SELECT pending_sheet_push AND memo='synthetic newer pending edit' FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',5)),
  'old success retains newer pending contents');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(6,13)->>'outcome'='send','date-change fixture begins');
UPDATE public.practice_records SET recorded_date=DATE '2100-01-01' WHERE id=pg_temp.sheet_uuid('8100',6);
SELECT pg_temp.assert_sheet(pg_temp.record_finish(6,13,true) @> '{"outcome":"completed","marker_status":"superseded"}','changed recorded date superseded');
SELECT pg_temp.assert_sheet((SELECT pending_sheet_push FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',6)) AND
 EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-07'),
 'date-change receipt retains current pending and old clear');
SELECT pg_temp.assert_sheet(pg_temp.record_begin(7,14)->>'outcome'='send','config-change fixture begins');
UPDATE public.profiles SET sheet_header_signature='synthetic changed header' WHERE id=pg_temp.sheet_uuid('8000',1);
SELECT pg_temp.assert_sheet(pg_temp.record_finish(7,14,true) @> '{"outcome":"completed","marker_status":"superseded"}','changed profile config superseded');
SELECT pg_temp.assert_sheet((SELECT pending_sheet_push FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',7)), 'config change preserves pending');
UPDATE public.profiles SET sheet_header_signature='synthetic-header' WHERE id=pg_temp.sheet_uuid('8000',1);

-- Clear intent binds queue.created_at, absence and raw profile, without a FK.
DELETE FROM public.practice_records WHERE id IN(pg_temp.sheet_uuid('8100',8),pg_temp.sheet_uuid('8100',9));
DO $$ DECLARE cfg jsonb;version timestamptz;answer jsonb; BEGIN
  cfg:=pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1));
  SELECT created_at INTO STRICT version FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-09';
  answer:=public.sheet_push_begin(pg_temp.sheet_uuid('8200',15),'clear',NULL,pg_temp.sheet_uuid('8000',1),DATE '2099-01-09',version+interval '1 second',
    cfg,pg_temp.sheet_sha('clear-slot-8'),pg_temp.sheet_sha('clear-target-8'),pg_temp.sheet_sha('clear-payload-8'));
  PERFORM pg_temp.assert_sheet(answer->>'outcome'='stale','clear queue version bound');
  answer:=public.sheet_push_begin(pg_temp.sheet_uuid('8200',16),'clear',NULL,pg_temp.sheet_uuid('8000',1),DATE '2099-01-09',version,
    cfg,pg_temp.sheet_sha('clear-slot-8'),pg_temp.sheet_sha('clear-target-8'),pg_temp.sheet_sha('clear-payload-8'));
  PERFORM pg_temp.assert_sheet(answer->>'outcome'='send','clear absence reserves');
  answer:=public.sheet_push_finish(pg_temp.sheet_uuid('8200',16),pg_temp.sheet_sha('clear-target-8'),pg_temp.sheet_sha('clear-payload-8'),true);
  PERFORM pg_temp.assert_sheet(answer @> '{"outcome":"completed","marker_status":"applied"}','known full clear completes matching queue CAS');
  PERFORM pg_temp.assert_sheet(NOT EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-09'),
    'known clear deletes only matching queue version');
END $$;
DO $$ DECLARE cfg jsonb;version timestamptz;answer jsonb; BEGIN
  cfg:=pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1));
  SELECT created_at INTO STRICT version FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-10';
  answer:=public.sheet_push_begin(pg_temp.sheet_uuid('8200',17),'clear',NULL,pg_temp.sheet_uuid('8000',1),DATE '2099-01-10',version,
    cfg,pg_temp.sheet_sha('clear-slot-9'),pg_temp.sheet_sha('clear-target-9'),pg_temp.sheet_sha('clear-payload-9'));
  PERFORM pg_temp.assert_sheet(answer->>'outcome'='send','second clear begins');
  UPDATE public.sheet_pending_clears SET created_at=version+interval '1 second' WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-10';
  answer:=public.sheet_push_finish(pg_temp.sheet_uuid('8200',17),pg_temp.sheet_sha('clear-target-9'),pg_temp.sheet_sha('clear-payload-9'),true);
  PERFORM pg_temp.assert_sheet(answer @> '{"outcome":"completed","marker_status":"superseded"}','newer clear queue not consumed');
  PERFORM pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-10'),
    'superseded clear remains CSV barrier');
END $$;
-- Recreating an app record after clear reservation cannot consume the old queue.
DELETE FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',16);
DO $$ DECLARE version timestamptz;answer jsonb; BEGIN
 SELECT created_at INTO STRICT version FROM public.sheet_pending_clears
  WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-17';
 answer:=public.sheet_push_begin(pg_temp.sheet_uuid('8200',216),'clear',NULL,pg_temp.sheet_uuid('8000',1),DATE '2099-01-17',version,
  pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('recreated-clear-slot'),pg_temp.sheet_sha('recreated-clear-target'),pg_temp.sheet_sha('recreated-clear-payload'));
 PERFORM pg_temp.assert_sheet(answer->>'outcome'='send','clear reserves before app record recreated');
 INSERT INTO public.practice_records(id,user_id,recorded_date,memo,pending_sheet_push,from_sheet)
  VALUES(pg_temp.sheet_uuid('8100',216),pg_temp.sheet_uuid('8000',1),DATE '2099-01-17','synthetic app recreation',true,false);
 answer:=public.sheet_clear_resolve(pg_temp.sheet_uuid('8000',1),DATE '2099-01-17',version,pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('recreated-clear-slot'));
 PERFORM pg_temp.assert_sheet(answer->>'outcome'='blocked','recreated app record cannot resolve active clear receipt');
 answer:=public.sheet_push_finish(pg_temp.sheet_uuid('8200',216),pg_temp.sheet_sha('recreated-clear-target'),pg_temp.sheet_sha('recreated-clear-payload'),true);
 PERFORM pg_temp.assert_sheet(answer @> '{"outcome":"completed","marker_status":"superseded"}','known clear does not consume recreated app record');
 PERFORM pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-17')
  AND (SELECT pending_sheet_push FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',216)),
  'recreated record stays pending and original clear queue stays a CSV barrier');
END $$;
-- No-provider resolution removes a proven queue CAS without inventing a receipt.
INSERT INTO public.sheet_pending_clears(user_id,recorded_date) VALUES(pg_temp.sheet_uuid('8000',1),DATE '2101-01-01');
SELECT pg_temp.assert_sheet(public.sheet_clear_resolve(pg_temp.sheet_uuid('8000',1),DATE '2101-01-01',
 (SELECT created_at FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2101-01-01'),
 pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('empty-clear-slot'))->>'outcome'='stale','no-record or empty CSV cannot resolve a queued actual-sheet clear');
SELECT pg_temp.assert_sheet(EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2101-01-01'),
 'no-record clear queue remains held without provider proof');
SELECT pg_temp.sheet_expect_sqlstate($s$INSERT INTO public.practice_records(id,user_id,recorded_date,memo,from_sheet,synced_at)
 VALUES('f6101117-0000-4000-8100-000000000301','f6101117-0000-4000-8000-000000000001',DATE '2101-01-01','synthetic queued CSV',true,clock_timestamp())$s$,'PT409');
INSERT INTO public.sheet_pending_clears(user_id,recorded_date) VALUES(pg_temp.sheet_uuid('8000',1),DATE '2099-01-11');
DO $$ DECLARE version timestamptz;before_count bigint;answer jsonb; BEGIN
  SELECT count(*) INTO before_count FROM public.sheet_push_attempts;
  SELECT created_at INTO STRICT version FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-11';
  answer:=public.sheet_push_begin(pg_temp.sheet_uuid('8200',18),'clear',NULL,pg_temp.sheet_uuid('8000',1),DATE '2099-01-11',version,
    pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('existing-clear-slot'),pg_temp.sheet_sha('existing-clear-target'),pg_temp.sheet_sha('existing-clear-payload'));
  PERFORM pg_temp.assert_sheet(answer->>'outcome'='stale','clear begin requires no current record');
  answer:=public.sheet_clear_resolve(pg_temp.sheet_uuid('8000',1),DATE '2099-01-11',version,pg_temp.sheet_config(pg_temp.sheet_uuid('8000',1)),pg_temp.sheet_sha('existing-clear-slot'));
  PERFORM pg_temp.assert_sheet(answer->>'outcome'='resolved','known no-provider queue resolution');
  PERFORM pg_temp.assert_sheet((SELECT count(*) FROM public.sheet_push_attempts)=before_count AND
    EXISTS(SELECT 1 FROM public.practice_records WHERE id=pg_temp.sheet_uuid('8100',10)) AND
    NOT EXISTS(SELECT 1 FROM public.sheet_pending_clears WHERE user_id=pg_temp.sheet_uuid('8000',1) AND recorded_date=DATE '2099-01-11'),
    'no-provider resolution retains record and creates no provider-success receipt');
END $$;

CREATE TEMP TABLE sheet_receipts_before AS SELECT to_jsonb(a) AS value FROM public.sheet_push_attempts a;
\ir /review/supabase/migrations/20261011170000_sheet_push_attempts.sql
\ir /review/supabase/migrations/20261011170000_sheet_push_attempts.sql
DO $$ BEGIN
  IF EXISTS((SELECT value FROM sheet_receipts_before EXCEPT SELECT to_jsonb(a) FROM public.sheet_push_attempts a)
    UNION ALL (SELECT to_jsonb(a) FROM public.sheet_push_attempts a EXCEPT SELECT value FROM sheet_receipts_before)) THEN
    RAISE EXCEPTION 'Reapplying receipt migration reset/mutated an attempt';
  END IF;
  IF EXISTS(SELECT 1 FROM sheet_existing_acl a WHERE a.allowed IS DISTINCT FROM has_table_privilege(a.role_name,a.relation,a.permission)) THEN
    RAISE EXCEPTION 'Existing profile/record/clear privileges changed';
  END IF;
END $$;
ROLLBACK;
\echo PASS: sheet receipt RLS/RPC grants, raw version/config/target/payload proof, durable unknown/partial holds, atomic marker CAS, superseded versions/date/config/clear, no-provider resolution, reapply and rollback

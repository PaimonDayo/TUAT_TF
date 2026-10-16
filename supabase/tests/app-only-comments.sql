-- Isolated synthetic DB only. Fixtures, migration (twice), and all mutations roll back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
  IF current_database()<>'tuat_rls_review'
    OR EXISTS(SELECT 1 FROM public.profiles WHERE email !~ '@[^@]+\.invalid$') THEN
    RAISE EXCEPTION 'Use the isolated synthetic tuat_rls_review database';
  END IF;
END $$;
DO $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); moderator uuid:=gen_random_uuid();
  target uuid:=gen_random_uuid(); own_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); role_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('request.headers','{"x-tuat-mirror":"1"}',true);
  INSERT INTO public.login_email_allowlist(email,created_by)
    VALUES(a||'@example.invalid',a),(b||'@example.invalid',b),(moderator||'@example.invalid',moderator);
  INSERT INTO auth.users(id,email) VALUES(a,a||'@example.invalid'),(b,b||'@example.invalid'),(moderator,moderator||'@example.invalid');
  INSERT INTO public.profiles(id,email,display_name) VALUES
    (a,a||'@example.invalid','合成本人'),(b,b||'@example.invalid','合成別部員'),(moderator,moderator||'@example.invalid','合成管理者')
    ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.roles(name) SELECT '管理者' WHERE NOT EXISTS(SELECT 1 FROM public.roles WHERE name='管理者');
  SELECT id INTO role_id FROM public.roles WHERE name='管理者';
  INSERT INTO public.profile_roles(profile_id,role_id) VALUES(moderator,role_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.practice_records(id,user_id,recorded_date) VALUES(target,a,DATE '2026-09-30');
  INSERT INTO public.tweets(id,user_id,content) VALUES(target,a,'合成の同一ID別種別');
  INSERT INTO public.comments(id,user_id,target_type,target_id,content,sheet_reply_index) VALUES
    (own_id,a,'record',target,'保持するアプリ返信',3),
    (other_id,b,'record',target,'管理者が削除する返信',NULL),
    (gen_random_uuid(),a,'tweet',target,'別種別の返信',NULL);
  INSERT INTO public.sheet_record_replies(record_id,owner_id,recorded_date,reply_index,content)
    VALUES(target,a,DATE '2026-09-30',3,'旧アプリ返信のSheets写し'),
      (target,a,DATE '2026-09-30',4,'履歴として保持するSheets独自返信');
  INSERT INTO public.sheet_reply_deletions(id,kind,actor_id,record_id,sheet_name,recorded_date,expected_content)
    VALUES(gen_random_uuid(),'app',a,target,'synthetic',DATE '2026-09-30','結果不明の旧削除履歴');
  INSERT INTO public.likes(user_id,target_type,target_id) VALUES(a,'record',target);
  PERFORM set_config('test.comment_owner',a::text,true);
  PERFORM set_config('test.comment_other',b::text,true);
  PERFORM set_config('test.comment_moderator',moderator::text,true);
  PERFORM set_config('test.comment_target',target::text,true);
  PERFORM set_config('test.comment_own_id',own_id::text,true);
  PERFORM set_config('test.comment_other_id',other_id::text,true);
END $$;
CREATE TEMP TABLE reply_history_before AS
  SELECT 'replies' AS source,coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) AS rows FROM public.sheet_record_replies r
  UNION ALL
  SELECT 'deletions',coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM public.sheet_reply_deletions d;
\ir ../migrations/20261016010000_app_only_comments.sql
\ir ../migrations/20261016010000_app_only_comments.sql
SET LOCAL ROLE authenticated;
DO $$
DECLARE target uuid:=current_setting('test.comment_target')::uuid; n bigint; rejected boolean;
BEGIN
  PERFORM set_config('request.headers','{}',true);
  PERFORM set_config('request.jwt.claim.sub',current_setting('test.comment_owner'),true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',current_setting('test.comment_owner'),
    'email',current_setting('test.comment_owner')||'@example.invalid','role','authenticated')::text,true);
  IF public.login_access_allowed() IS NOT TRUE THEN RAISE EXCEPTION 'Synthetic owner login access denied'; END IF;
  -- Counts and likes must distinguish the record from a tweet with the same UUID.
  SELECT count INTO n FROM public.count_comments_by_target('record',ARRAY[target]);
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Imported sheet reply counted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_feed_social_state(ARRAY[target],ARRAY[target])
      WHERE target_type='record' AND target_id=target AND comments_count=2 AND liked_by_me)
    OR NOT EXISTS(SELECT 1 FROM public.get_feed_social_state(ARRAY[target],ARRAY[target])
      WHERE target_type='tweet' AND target_id=target AND comments_count=1 AND NOT liked_by_me)
    THEN RAISE EXCEPTION 'Feed count/like target type changed'; END IF;
  rejected:=false;
  BEGIN PERFORM public.delete_comment_with_sheet(current_setting('test.comment_other_id')::uuid,'app');
    EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Another member could delete an app comment'; END IF;
  rejected:=false;
  BEGIN PERFORM public.delete_comment_with_sheet(current_setting('test.comment_own_id')::uuid,'sheet');
    EXCEPTION WHEN feature_not_supported THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Retired Sheet deletion accepted'; END IF;
  PERFORM public.delete_comment_with_sheet(current_setting('test.comment_own_id')::uuid,'app');
  PERFORM public.delete_comment_with_sheet(current_setting('test.comment_own_id')::uuid,'app'); -- idempotent absence
  IF EXISTS(SELECT 1 FROM public.comments WHERE id=current_setting('test.comment_own_id')::uuid)
    THEN RAISE EXCEPTION 'Owner deletion failed'; END IF;
  PERFORM set_config('request.jwt.claim.sub',current_setting('test.comment_moderator'),true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',current_setting('test.comment_moderator'),
    'email',current_setting('test.comment_moderator')||'@example.invalid','role','authenticated')::text,true);
  IF public.login_access_allowed() IS NOT TRUE THEN RAISE EXCEPTION 'Synthetic moderator login access denied'; END IF;
  PERFORM public.delete_comment_with_sheet(current_setting('test.comment_other_id')::uuid,'app');
  IF EXISTS(SELECT 1 FROM public.comments WHERE id=current_setting('test.comment_other_id')::uuid)
    THEN RAISE EXCEPTION 'Moderator deletion failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_feed_social_state(ARRAY[target],ARRAY[]::uuid[]) WHERE comments_count=0)
    THEN RAISE EXCEPTION 'Zero app comments must remain zero'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  -- Verify as the fixture owner too, so RLS cannot conceal a failed deletion.
  IF EXISTS(SELECT 1 FROM public.comments WHERE id IN
    (current_setting('test.comment_own_id')::uuid,current_setting('test.comment_other_id')::uuid))
    THEN RAISE EXCEPTION 'Owner or moderator deletion left a comment behind'; END IF;
  IF has_table_privilege('authenticated','public.sheet_record_replies','SELECT')
    OR NOT has_table_privilege('service_role','public.sheet_record_replies','SELECT')
    OR has_function_privilege('authenticated','public.replace_sheet_record_replies(uuid,jsonb)','EXECUTE')
    OR has_function_privilege('service_role','public.replace_sheet_record_replies(uuid,jsonb)','EXECUTE')
    THEN RAISE EXCEPTION 'Retired source permissions are unsafe'; END IF;
  IF EXISTS(SELECT 1 FROM reply_history_before b WHERE b.rows IS DISTINCT FROM
    CASE b.source WHEN 'replies' THEN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM public.sheet_record_replies r)
      ELSE (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]'::jsonb) FROM public.sheet_reply_deletions d) END)
    THEN RAISE EXCEPTION 'Historical replies or deletion queue changed'; END IF;
END $$;
ROLLBACK;

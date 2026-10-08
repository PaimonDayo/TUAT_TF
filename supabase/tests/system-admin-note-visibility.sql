-- Run only on the isolated synthetic review DB. Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_database() <> 'tuat_review' THEN
    RAISE EXCEPTION 'Use the isolated synthetic review database';
  END IF;
END $$;
\ir ../migrations/20261008010000_system_admin_note_visibility.sql
\ir ../migrations/20261008010000_system_admin_note_visibility.sql

DO $$ DECLARE author_id uuid := gen_random_uuid(); system_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid(); editor_id uuid := gen_random_uuid();
  system_role uuid := gen_random_uuid(); folder_id uuid := gen_random_uuid();
  child_id uuid := gen_random_uuid(); personal_id uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (
    SELECT pr.profile_id FROM public.profile_roles pr JOIN public.roles r ON r.id = pr.role_id
    WHERE r.can_manage_system LIMIT 1
  ), 'role', 'authenticated')::text, true);
  IF NOT public.can_manage_system() THEN RAISE EXCEPTION 'Synthetic admin fixture missing'; END IF;
  INSERT INTO auth.users(id, email) VALUES
    (author_id, author_id || '@example.invalid'), (system_id, system_id || '@example.invalid'),
    (member_id, member_id || '@example.invalid'), (editor_id, editor_id || '@example.invalid');
  INSERT INTO public.profiles(id, email, display_name) VALUES
    (author_id, author_id || '@example.invalid', '合成作者'),
    (system_id, system_id || '@example.invalid', '合成システム管理者'),
    (member_id, member_id || '@example.invalid', '合成一般部員'),
    (editor_id, editor_id || '@example.invalid', '合成編集者') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.roles(id, name, can_manage_system, can_manage_members)
    VALUES (system_role, '合成システム管理-' || system_role, true, false);
  INSERT INTO public.profile_roles(profile_id, role_id) VALUES (system_id, system_role);
  INSERT INTO public.notes(id, author_id, scope, title, status, edit_policy) VALUES
    (folder_id, author_id, 'shared', '合成下書き', 'draft', 'specified'),
    (child_id, author_id, 'shared', '合成子下書き', 'draft', 'author'),
    (personal_id, author_id, 'personal', '合成個人下書き', 'draft', 'author');
  UPDATE public.notes SET parent_id = folder_id WHERE id = child_id;
  INSERT INTO public.note_editors(note_id, user_id) VALUES (folder_id, editor_id);
  INSERT INTO public.note_articles(note_id, author_id, title, body)
    VALUES (folder_id, author_id, '合成記事', '権限検証');
  INSERT INTO public.threads(author_id, title, folder_id)
    VALUES (author_id, '合成スレッド', folder_id);
  PERFORM set_config('test.author', author_id::text, true);
  PERFORM set_config('test.system', system_id::text, true);
  PERFORM set_config('test.member', member_id::text, true);
  PERFORM set_config('test.editor', editor_id::text, true);
  PERFORM set_config('test.folder', folder_id::text, true);
  PERFORM set_config('test.child', child_id::text, true);
  PERFORM set_config('test.personal', personal_id::text, true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE folder_id uuid := current_setting('test.folder')::uuid; n integer;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('test.system'), 'role', 'authenticated')::text, true);
  IF NOT public.can_manage_system() OR public.is_admin() THEN RAISE EXCEPTION 'System-only fixture is invalid'; END IF;
  SELECT count(*) INTO n FROM public.notes WHERE id IN (folder_id, current_setting('test.child')::uuid, current_setting('test.personal')::uuid);
  IF n <> 3 THEN RAISE EXCEPTION 'System manager cannot read every draft'; END IF;
  IF NOT public.can_view_note(folder_id) THEN RAISE EXCEPTION 'Folder contents are inaccessible'; END IF;
  IF (SELECT count(*) FROM public.note_articles WHERE note_id = folder_id) <> 1 THEN RAISE EXCEPTION 'Article inaccessible'; END IF;
  IF (SELECT count(*) FROM public.threads t WHERE t.folder_id = current_setting('test.folder')::uuid) <> 1 THEN RAISE EXCEPTION 'Thread inaccessible'; END IF;
  UPDATE public.notes SET title = 'Unexpected edit' WHERE id = folder_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Viewing granted editing'; END IF;
  DELETE FROM public.notes WHERE id = folder_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Viewing granted deletion'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('test.author'), 'role', 'authenticated')::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.notes WHERE id = folder_id) THEN RAISE EXCEPTION 'Author lost their draft'; END IF;
  UPDATE public.notes SET edit_policy = 'author' WHERE id = folder_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Author cannot recover mistaken permissions'; END IF;
  UPDATE public.notes SET edit_policy = 'specified' WHERE id = folder_id;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('test.editor'), 'role', 'authenticated')::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.notes WHERE id = folder_id) THEN RAISE EXCEPTION 'Existing editor access lost'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', current_setting('test.member'), 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM public.notes WHERE id IN (folder_id, current_setting('test.child')::uuid, current_setting('test.personal')::uuid)) THEN RAISE EXCEPTION 'Unrelated member can read private drafts'; END IF;
  IF public.can_view_note(folder_id) THEN RAISE EXCEPTION 'Contents exposed to unrelated member'; END IF;
END $$;
ROLLBACK;
\echo PASS: system-only viewing, own draft recovery, editor access, unrelated member denial, unchanged writes, idempotency, rollback

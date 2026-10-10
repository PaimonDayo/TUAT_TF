// Standalone isolated PostgreSQL regression test. Never connects to a live DB.
// Install @electric-sql/pglite in an ignored temporary folder and pass its module file as argv[2].
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const manager = '00000000-0000-4000-8000-000000000001';
const person = '00000000-0000-4000-8000-000000000002';
const roleId = '00000000-0000-4000-8000-000000000003';
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE ROLE supabase_auth_admin; CREATE ROLE authenticator;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role, supabase_auth_admin;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
    CREATE TABLE public.roles(id uuid PRIMARY KEY, can_manage_members boolean, is_everyone boolean);
    CREATE TABLE public.profile_roles(profile_id uuid, role_id uuid);
    INSERT INTO public.roles VALUES ('${roleId}',true,false);
    INSERT INTO public.profile_roles VALUES ('${manager}','${roleId}');
    CREATE FUNCTION public.can_manage_members() RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path='' AS $$
      SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.roles r WHERE r.can_manage_members AND
      (r.is_everyone OR EXISTS (SELECT 1 FROM public.profile_roles pr WHERE pr.role_id=r.id AND pr.profile_id=auth.uid()))) $$;
    CREATE TABLE public.failover_config(id boolean PRIMARY KEY, log_changes boolean);
    INSERT INTO public.failover_config VALUES(true,false);
    CREATE FUNCTION public.is_mirror_write() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT auth.role()='service_role' AND coalesce(current_setting('request.headers',true),'{}')::jsonb->>'x-tuat-mirror'='1' $$;
    CREATE TABLE public.fixture_documents(id int PRIMARY KEY);
    INSERT INTO public.fixture_documents VALUES(1);
    ALTER TABLE public.fixture_documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY existing_documents ON public.fixture_documents FOR ALL TO authenticated USING(true) WITH CHECK(true);
    GRANT ALL ON public.fixture_documents TO authenticated;
    CREATE TABLE storage.objects(id int PRIMARY KEY);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    INSERT INTO storage.objects VALUES(1);
    CREATE POLICY existing_storage ON storage.objects FOR SELECT TO authenticated USING(true);
    GRANT SELECT ON storage.objects TO authenticated;
  `);
  const migration = await readFile(new URL('../../supabase/migrations/20261011010000_login_email_allowlist.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // idempotent
  async function identity(id, email, role = 'authenticated', extra = {}) {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:id, email, role, ...extra })]);
    await db.exec(`SET ROLE ${role}`);
  }
  async function denied(sql, code) {
    await assert.rejects(db.exec(sql), error => error.code === code);
  }
  await identity(manager, 'manager@st.go.tuat.ac.jp');
  assert.equal((await db.query('SELECT public.login_access_allowed() AS allowed')).rows[0].allowed, true);
  await db.exec('SELECT public.check_login_access()');
  await db.exec("INSERT INTO public.login_email_allowlist(email) VALUES('person@example.invalid')");
  await denied("INSERT INTO public.login_email_allowlist(email) VALUES('person@example.invalid')", '23505');
  await denied("INSERT INTO public.login_email_allowlist(email) VALUES('Upper@Example.invalid')", '23514');
  await denied("INSERT INTO public.login_email_allowlist(email) VALUES('student@st.go.tuat.ac.jp')", '23514');
  await denied("INSERT INTO public.login_email_allowlist(email,created_by) VALUES('spoof@example.invalid','00000000-0000-4000-8000-000000000009')", '42501');
  await identity(null, null, 'supabase_auth_admin');
  assert.deepEqual((await db.query("SELECT public.hook_restrict_signup_by_email_domain($1::jsonb) AS result", [JSON.stringify({user:{email:'PERSON@EXAMPLE.INVALID'}})])).rows[0].result, {});
  assert.equal((await db.query("SELECT public.hook_restrict_signup_by_email_domain($1::jsonb) AS result", [JSON.stringify({user:{email:'other@example.invalid'}})])).rows[0].result.error.http_code,403);
  await identity(person, 'PERSON@EXAMPLE.INVALID');
  assert.equal((await db.query('SELECT public.login_access_allowed() AS allowed')).rows[0].allowed,true);
  await db.exec('SELECT public.check_login_access()');
  assert.equal((await db.query('SELECT * FROM public.fixture_documents')).rows.length,1);
  assert.equal((await db.query('SELECT * FROM public.login_email_allowlist')).rows.length,0);
  await denied("INSERT INTO public.login_email_allowlist(email) VALUES('other@example.invalid')",'42501');
  await denied("SELECT public.login_email_is_allowed('person@example.invalid')",'42501');
  await denied("SELECT public.hook_restrict_signup_by_email_domain('{}')",'42501');
  await identity(person, 'other@example.invalid','authenticated',{user_metadata:{email:'student@st.go.tuat.ac.jp'}});
  assert.equal((await db.query('SELECT public.login_access_allowed() AS allowed')).rows[0].allowed,false);
  await denied('SELECT public.check_login_access()','PT403');
  assert.equal((await db.query('SELECT * FROM public.fixture_documents')).rows.length,0);
  await identity(manager, 'manager@st.go.tuat.ac.jp');
  assert.equal((await db.query("DELETE FROM public.login_email_allowlist WHERE email='person@example.invalid' RETURNING email")).rows.length,1);
  await identity(person, 'person@example.invalid');
  await denied('SELECT public.check_login_access()','PT403');
  assert.equal((await db.query('SELECT * FROM public.fixture_documents')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
  await denied('INSERT INTO public.fixture_documents VALUES(2)','42501');
  await db.exec('RESET ROLE; UPDATE public.failover_config SET log_changes=true');
  await identity(manager, 'manager@st.go.tuat.ac.jp');
  await denied("INSERT INTO public.login_email_allowlist(email) VALUES('cloud-write@example.invalid')",'PT503');
  await identity(null,null,'service_role');
  await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify({'x-tuat-mirror':'1'})]);
  await db.exec("INSERT INTO public.login_email_allowlist(email,created_by) VALUES('mirror@example.invalid','00000000-0000-4000-8000-000000000001')");
  await db.exec('SELECT public.check_login_access()');
  await identity(null,null,'anon');
  await denied('SELECT * FROM public.login_email_allowlist','42501');
  // An unrelated pre-request hook must stop migration instead of being overwritten.
  await db.exec("RESET ROLE; ALTER ROLE authenticator SET pgrst.db_pre_request='public.existing_hook';");
  await assert.rejects(db.exec(migration), /Existing PostgREST pre-request hook/);
  console.log('PASS isolated DB: admission, exact email, role boundary, RLS, revocation, mirror-only failover, idempotence, existing hook preservation');
} finally { await db.close(); }

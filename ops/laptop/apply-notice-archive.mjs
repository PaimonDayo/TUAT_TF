// Additive migration with private snapshot and rollback-only permission checks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, directory, writePrivate } from './backend-files.mjs';
import { wslArgs } from './server-profile.mjs';
const migration = readFileSync(resolve(root, 'supabase/migrations/20260922010000_notice_archive.sql'), 'utf8');
function sql(input) {
  return execFileSync('wsl', [...wslArgs(), 'docker', 'exec', '-i', 'supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', windowsHide: true, timeout: 60000 });
}
const snapshot = sql(`SELECT jsonb_build_object('notices',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM public.notices n),'policies',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname='public' AND tablename='notices'),'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid)) FROM pg_trigger WHERE tgrelid='public.notices'::regclass AND NOT tgisinternal));`);
writePrivate(resolve(directory, `notice-archive-before-${Date.now()}.json`), snapshot);
const checks = `
CREATE TEMP TABLE archive_baseline AS SELECT id, to_jsonb(n)-'archived_at' AS body FROM public.notices n;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notices' AND cmd='UPDATE' AND roles=ARRAY['authenticated']::name[] AND qual LIKE '%can_create_notice()%') THEN RAISE EXCEPTION 'Unexpected notice policy'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', (SELECT p.id::text FROM public.profiles p WHERE EXISTS (SELECT 1 FROM public.roles r WHERE r.can_create_notice AND (r.is_everyone OR EXISTS(SELECT 1 FROM public.profile_roles pr WHERE pr.profile_id=p.id AND pr.role_id=r.id))) LIMIT 1), true);
SELECT set_config('archive.test_id', (SELECT id::text FROM public.notices ORDER BY created_at DESC LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
 UPDATE public.notices SET archived_at=now() WHERE id=current_setting('archive.test_id')::uuid;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Authorized archive failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.notices WHERE id=current_setting('archive.test_id')::uuid AND archived_at IS NULL) THEN RAISE EXCEPTION 'Archived notice remains visible'; END IF;
 UPDATE public.notices SET archived_at=NULL WHERE id=current_setting('archive.test_id')::uuid;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Restore failed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
 UPDATE public.notices SET archived_at=now() WHERE id=current_setting('archive.test_id')::uuid;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'Unauthenticated update allowed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
 UPDATE public.notices SET archived_at=now();
 IF FOUND THEN RAISE EXCEPTION 'Anonymous update allowed'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM archive_baseline b FULL JOIN public.notices n USING(id) WHERE b.body IS DISTINCT FROM (to_jsonb(n)-'archived_at')) THEN RAISE EXCEPTION 'Notice data changed'; END IF;
END $$;
`;
sql(`BEGIN; SET LOCAL lock_timeout='5s'; ${migration} ${migration} ${checks} ROLLBACK;`);
console.log('Rollback rehearsal: idempotence, archive/restore, no-session and anonymous rejection, original data preserved.');
if (process.argv.includes('--apply')) {
  sql(`BEGIN; SET LOCAL lock_timeout='5s'; ${migration}
DO $$ BEGIN
IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20260922010000','notice_archive',ARRAY[$migration$${migration}$migration$]) ON CONFLICT(version) DO NOTHING;
END IF;
END $$;
COMMIT; NOTIFY pgrst, 'reload schema';`);
  writePrivate(resolve(directory, 'notice-archive-applied.json'), JSON.stringify({ appliedAt: new Date().toISOString(), migration }));
  console.log(sql("SELECT jsonb_build_object('total',count(*),'archived',count(archived_at)) FROM public.notices;").trim());
}

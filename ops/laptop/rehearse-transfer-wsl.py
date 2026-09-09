"""Restore the encrypted backup into a separate DB and exercise the return import."""
import importlib.util
import json
import pathlib
import subprocess
import uuid

repo = pathlib.Path('/mnt/c/Paimon Dayo/TUAT_TF')
out = pathlib.Path('/opt/tuat-tf-supabase/transfer')
out.mkdir(mode=0o700, exist_ok=True)
database = 'pc_return_rehearsal_' + uuid.uuid4().hex[:8]
spec = importlib.util.spec_from_file_location('transfer', repo / 'ops/laptop/database-transfer.py')
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)


def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=180)
    if result.returncode:
        (out / (database + '.error.log')).write_bytes(result.stderr)
        raise RuntimeError('Rehearsal failed; details retained in protected local log')
    return result.stdout


def sql(text, db=database):
    return run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', db], text.encode())


def snapshot(label):
    path = out / (database + '-' + label + '.jsonl')
    path.write_bytes(sql((repo / 'ops/laptop/snapshot.sql').read_text()))
    path.chmod(0o600)
    return transfer.read_snapshot(path)


sql('CREATE DATABASE ' + transfer.ident(database) + ';', 'postgres')
sql('DROP SCHEMA public; CREATE SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;')
dump = (repo / '.contingency/backend/restore-rehearsal.dump').read_bytes()
run(['docker', 'exec', '-i', 'supabase-db', 'pg_restore', '-U', 'supabase_admin', '-d', database, '--single-transaction', '--exit-on-error'], dump)
sql((repo / 'ops/laptop/freeze-install.sql').read_text())
uid = sql('SELECT id FROM auth.users ORDER BY id LIMIT 1;').decode().strip()
competition = 'pc-return-' + uuid.uuid4().hex
sql("SET session_replication_role=replica; INSERT INTO public.competitions(id,name,starts_on) VALUES(" + transfer.literal(competition) + ",'復帰検証','2026-09-21');" +
    "INSERT INTO public.competition_goals(competition_id,user_id,event,target) VALUES " +
    ','.join('(' + ','.join(map(transfer.literal, [competition, uid, event, 'before'])) + ')' for event in ['100m', '200m']) + ';')
before = snapshot('before')
edge = "編集後 $pc$ ' ; -- \\ 日本語\n改行"
sql("SET session_replication_role=replica; UPDATE public.competition_goals SET target=" + transfer.literal(edge) + ' WHERE competition_id=' + transfer.literal(competition) + " AND event='100m'; DELETE FROM public.competition_goals WHERE competition_id=" + transfer.literal(competition) + " AND event='200m';" +
    "INSERT INTO public.competition_goals(competition_id,user_id,event,target) VALUES(" + ','.join(map(transfer.literal, [competition, uid, '400m', 'new'])) + ');')
after = snapshot('after')
sql('UPDATE pc_ops.control SET frozen=true WHERE singleton;')
rollback_sql, _ = transfer.generate(after, before)
sql(rollback_sql)
forward_sql, report = transfer.generate(before, after)
sql(forward_sql)
actual = snapshot('actual')
for table in after:
    canonical = lambda rows: sorted(json.dumps(row, sort_keys=True, ensure_ascii=False) for row in rows)
    if canonical(after[table]['rows']) != canonical(actual[table]['rows']):
        raise RuntimeError('Restored data mismatch')
# The same baseline cannot be applied again after data changed: reject without partial writes.
retry = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database], input=forward_sql.encode(), capture_output=True)
if retry.returncode == 0 or b'Baseline mismatch' not in retry.stderr:
    raise RuntimeError('Baseline mismatch was not rejected')
broken = json.loads(json.dumps(after))
goals = broken['"public"."competition_goals"']['rows']
next(row for row in goals if row['competition_id'] == competition)['user_id'] = str(uuid.uuid4())
invalid_sql, _ = transfer.generate(after, broken)
invalid = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database], input=invalid_sql.encode(), capture_output=True)
if invalid.returncode == 0 or b'Foreign key validation failed' not in invalid.stderr:
    raise RuntimeError('Invalid relationship was not rejected')
final = snapshot('after-rejections')
for table in after:
    if canonical(after[table]['rows']) != canonical(final[table]['rows']):
        raise RuntimeError('Rejected import modified data')
report.update(database=database, backupRestored=True, baselineMismatchRejected=True, invalidForeignKeyRejected=True, rollbackPreservesData=True)
(out / 'rehearsal-result.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))

"""Apply the frozen cloud snapshot to this PC only; preserve a complete baseline."""
import importlib.util
import json
import pathlib
import subprocess
import sys

repo = pathlib.Path('/mnt/c/Paimon Dayo/TUAT_TF')
out = pathlib.Path('/opt/tuat-tf-supabase/transfer')
source = out / 'cloud-frozen-final-20260909.jsonl'
spec = importlib.util.spec_from_file_location('transfer', repo / 'ops/laptop/database-transfer.py')
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)

def sql(text):
    r = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], input=text.encode(), capture_output=True, timeout=180)
    if r.returncode:
        (out / 'cutover-error.log').write_bytes(r.stderr)
        raise RuntimeError('Local import failed; protected error log retained, transaction rolled back')
    return r.stdout

if not source.exists() or (out / 'cutover-applied.json').exists():
    raise SystemExit('Frozen source missing or cutover already applied')
sql((repo / 'ops/laptop/freeze-install.sql').read_text())
sql('UPDATE pc_ops.control SET frozen=true WHERE singleton;')
before = out / 'pc-final-baseline-20260909.jsonl'
if before.exists():
    raise SystemExit('Final baseline exists; inspect before retrying')
before.write_bytes(sql((repo / 'ops/laptop/snapshot.sql').read_text()))
before.chmod(0o600)
statement, report = transfer.generate(transfer.read_snapshot(before), transfer.read_snapshot(source))
plan = out / 'pc-final-import.sql'
plan.write_text(statement)
plan.chmod(0o600)
sql(statement)
actual = out / 'pc-final-verified-20260909.jsonl'
actual.write_bytes(sql((repo / 'ops/laptop/snapshot.sql').read_text()))
actual.chmod(0o600)
expected, restored = transfer.read_snapshot(source), transfer.read_snapshot(actual)
for table in expected:
    canonical = lambda rows: sorted(json.dumps(row, sort_keys=True) for row in rows)
    if canonical(expected[table]['rows']) != canonical(restored[table]['rows']):
        raise RuntimeError('Imported rows differ')
report['verifiedAllRows'] = True
report['profiles'] = len(restored['"public"."profiles"']['rows'])
(out / 'cutover-applied.json').write_text(json.dumps(report))
print(json.dumps(report))

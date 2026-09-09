"""Freeze the PC and prepare a baseline-checked return plan. Does not write to cloud."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
from datetime import datetime, timezone

repo = pathlib.Path('/mnt/c/Paimon Dayo/TUAT_TF')
out = pathlib.Path('/opt/tuat-tf-supabase/transfer')
config = json.loads((repo / '.contingency/backend/config.json').read_text())
if config.get('maintenance') is not True:
    raise SystemExit('Enable backend maintenance before preparing a return')
spec = importlib.util.spec_from_file_location('transfer', repo / 'ops/laptop/database-transfer.py')
transfer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transfer)
stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
def sql(text):
    result = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], input=text.encode(), capture_output=True, timeout=180)
    if result.returncode:
        error = out / f'return-{stamp}-error.log'
        error.write_bytes(result.stderr)
        error.chmod(0o600)
        raise RuntimeError('Return preparation failed; protected error log retained')
    return result.stdout
baseline = out / 'cloud-frozen-final-20260909.jsonl'
if not baseline.is_file():
    raise SystemExit('Original frozen cloud baseline missing')
sql('UPDATE pc_ops.control SET frozen=true WHERE singleton;')
latest = out / f'return-{stamp}-pc.jsonl'
latest.write_bytes(sql((repo / 'ops/laptop/snapshot.sql').read_text()))
latest.chmod(0o600)
statement, report = transfer.generate(transfer.read_snapshot(baseline), transfer.read_snapshot(latest))
plan = out / f'return-{stamp}.sql'
plan.write_text(statement, encoding='utf8')
plan.chmod(0o600)
report.update(plan=plan.name, latest=latest.name, sha256=hashlib.sha256(statement.encode()).hexdigest())
report_path = plan.with_suffix('.report.json')
report_path.write_text(json.dumps(report), encoding='utf8')
report_path.chmod(0o600)
print(json.dumps(report))

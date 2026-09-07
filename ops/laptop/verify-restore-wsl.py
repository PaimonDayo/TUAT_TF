"""Compare every COPY table's row count with the local-only restored DB."""
import hashlib
import json
import pathlib
import re
import subprocess

root = pathlib.Path('/opt/tuat-tf-supabase')
backup = pathlib.Path((root / 'latest-backup-path').read_text().strip()).resolve()
if root / 'backups' not in backup.parents:
    raise SystemExit('Unexpected backup path')
tables = {}
ids = {}
id_column = None
current = None
for line in (backup / 'data.sql').open():
    if current is not None:
        if line.rstrip('\n') == r'\.':
            current = None
        else:
            tables[current] += 1
            if id_column is not None:
                ids[current].append(line.rstrip('\n').split('\t')[id_column])
    else:
        match = re.match(r'^COPY ("[a-zA-Z0-9_]+"\."[a-zA-Z0-9_]+") \(', line)
        if match:
            current = match[1]
            tables[current] = 0
            columns = re.findall(r'"([a-zA-Z0-9_]+)"', line.split('(', 1)[1])
            id_column = columns.index('id') if 'id' in columns else None
            if id_column is not None:
                ids[current] = []
if current or '"auth"."users"' not in tables:
    raise SystemExit('Incomplete COPY backup')
sql = '\n'.join(f"SELECT '{table}', count(*) FROM {table};" for table in tables)
result = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True)
if result.returncode:
    raise SystemExit('Local verification query failed; inspect locally without exposing data')
actual = dict(line.rsplit('|', 1) for line in result.stdout.splitlines())
mismatches = {table: {'backup': count, 'local': actual.get(table)} for table, count in tables.items() if str(count) != actual.get(table)}
report = {'tablesCompared': len(tables), 'rowsCompared': sum(tables.values()), 'mismatches': mismatches, 'dataSha256': hashlib.file_digest((backup / 'data.sql').open('rb'), 'sha256').hexdigest()}
id_sql = '\n'.join(f"SELECT '{table}', md5(coalesce(string_agg(id::text, ',' ORDER BY id::text COLLATE \"C\"), '')) FROM {table};" for table in ids)
id_result = subprocess.run(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], input=id_sql, text=True, capture_output=True)
if id_result.returncode:
    raise SystemExit('Local ID verification query failed')
id_actual = dict(line.rsplit('|', 1) for line in id_result.stdout.splitlines())
id_mismatches = [table for table, values in ids.items() if hashlib.md5(','.join(sorted(values)).encode()).hexdigest() != id_actual.get(table)]
report.update({'idTablesCompared': len(ids), 'idMismatches': id_mismatches})
(root / 'restore-verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
if mismatches or id_mismatches:
    raise SystemExit(1)

"""Generate an atomic, baseline-checked return import. Never connects to a database.

Inputs are snapshot.sql JSON lines captured under one repeatable-read transaction.
The generated SQL requires the destination write gate to be frozen. It preserves
platform configuration/sessions and validates every imported foreign key before commit.
"""
import argparse
import hashlib
import json
import pathlib


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def block(sql):
    tag = '$pc_' + hashlib.sha256(sql.encode()).hexdigest()[:24] + '$'
    while tag in sql:
        tag = tag[:-1] + 'x$'
    return 'DO ' + tag + ' ' + sql + ' ' + tag + ';'


def read_snapshot(path):
    tables = {}
    for line in pathlib.Path(path).read_text(encoding='utf-8-sig').splitlines():
        if not line.startswith('{'):
            continue
        value = json.loads(line)
        schema, name = value['schema'], value['name']
        if schema != 'public' and (schema, name) not in [('auth', 'users'), ('auth', 'identities')]:
            raise ValueError('Unexpected snapshot schema')
        table = ident(schema) + '.' + ident(name)
        if table in tables or not value['columns']:
            raise ValueError('Invalid snapshot table')
        tables[table] = value
    if '"auth"."users"' not in tables or '"public"."profiles"' not in tables:
        raise ValueError('Incomplete application snapshot')
    return tables


def rowkey(row, pk):
    return json.dumps([row[col] for col in pk], ensure_ascii=False, sort_keys=True)


def generate(before, after):
    if before.keys() != after.keys():
        raise ValueError('Schema changed: review the table set before importing')
    lines = ["\\set ON_ERROR_STOP on", 'BEGIN;', "SET LOCAL standard_conforming_strings=on;", "SET LOCAL lock_timeout='10s';", "SET LOCAL statement_timeout='120s';",
             "DO $$ BEGIN IF NOT coalesce((SELECT frozen FROM pc_ops.control WHERE singleton),false) THEN RAISE EXCEPTION 'Destination must be frozen'; END IF; END $$;",
             'LOCK TABLE ' + ','.join(sorted(before)) + ' IN ACCESS EXCLUSIVE MODE;',
             "SET LOCAL pc_ops.restore='on';", 'SET LOCAL session_replication_role=replica;']
    report = {'tables': len(before), 'inserted': 0, 'updated': 0, 'deleted': 0}
    # Validate every destination table against the baseline, including tables with no changes.
    # EXCEPT ALL catches duplicate rows as well as differences; SQL JSON numeric formatting is irrelevant.
    for table in sorted(before):
        old, new = before[table], after[table]
        if any(old[key] != new[key] for key in ['columns', 'pk', 'foreignKeys']):
            raise ValueError('Schema changed: ' + table)
        payload = literal(json.dumps(old['rows'], ensure_ascii=False, separators=(',', ':')))
        lines.append(block(f"BEGIN IF EXISTS((SELECT to_jsonb(t) FROM {table} t EXCEPT ALL SELECT value FROM jsonb_array_elements({payload}::jsonb)) UNION ALL (SELECT value FROM jsonb_array_elements({payload}::jsonb) EXCEPT ALL SELECT to_jsonb(t) FROM {table} t)) THEN RAISE EXCEPTION 'Baseline mismatch'; END IF; END"))
        if not old['pk']:
            # No-PK tables are allowed only if identical. Never invent an identity or wipe them.
            if sorted(map(lambda x: json.dumps(x, sort_keys=True), old['rows'])) != sorted(map(lambda x: json.dumps(x, sort_keys=True), new['rows'])):
                raise ValueError('Changed table has no primary key: ' + table)
            continue
        oldrows = {rowkey(row, old['pk']): row for row in old['rows']}
        newrows = {rowkey(row, new['pk']): row for row in new['rows']}
        if len(oldrows) != len(old['rows']) or len(newrows) != len(new['rows']):
            raise ValueError('Duplicate primary key')
        removed = [row for key, row in oldrows.items() if key not in newrows]
        changed = [row for key, row in newrows.items() if oldrows.get(key) != row]
        report['deleted'] += len(removed)
        report['inserted'] += len(newrows.keys() - oldrows.keys())
        report['updated'] += sum(key in oldrows and oldrows[key] != row for key, row in newrows.items())
        if removed:
            payload = literal(json.dumps(removed, ensure_ascii=False, separators=(',', ':')))
            match = ' AND '.join(f't.{ident(col)} IS NOT DISTINCT FROM x.{ident(col)}' for col in old['pk'])
            lines.append(f'DELETE FROM {table} t USING jsonb_populate_recordset(NULL::{table},{payload}::jsonb) x WHERE {match};')
        if changed:
            columns = [col['name'] for col in old['columns'] if not col['generated']]
            quoted = ','.join(map(ident, columns))
            conflict = ','.join(map(ident, old['pk']))
            updates = ','.join(f'{ident(col)}=EXCLUDED.{ident(col)}' for col in columns if col not in old['pk'])
            payload = literal(json.dumps(changed, ensure_ascii=False, separators=(',', ':')))
            action = 'DO UPDATE SET ' + updates if updates else 'DO NOTHING'
            lines.append(f'INSERT INTO {table} ({quoted}) OVERRIDING SYSTEM VALUE SELECT {quoted} FROM jsonb_populate_recordset(NULL::{table},{payload}::jsonb) ON CONFLICT ({conflict}) {action};')
    # Replica mode avoids duplicate notifications, but skips FK checks. Validate the
    # relationships directly: managed Auth tables do not permit ALTER CONSTRAINT.
    lines.append("""DO $validate_fk$
DECLARE r record; condition text; present text; all_null text; broken boolean;
BEGIN
  FOR r IN SELECT k.*,ns.nspname AS source_schema,cs.relname AS source_table,nt.nspname AS target_schema,ct.relname AS target_table
    FROM pg_constraint k JOIN pg_class cs ON cs.oid=k.conrelid JOIN pg_namespace ns ON ns.oid=cs.relnamespace
    JOIN pg_class ct ON ct.oid=k.confrelid JOIN pg_namespace nt ON nt.oid=ct.relnamespace
    WHERE k.contype='f' AND (ns.nspname IN ('public','auth','storage') OR nt.nspname='public')
  LOOP
    SELECT string_agg(format('s.%I=t.%I',a.attname,b.attname),' AND ' ORDER BY u.ord),
           string_agg(format('s.%I IS NOT NULL',a.attname),' AND ' ORDER BY u.ord),
           string_agg(format('s.%I IS NULL',a.attname),' AND ' ORDER BY u.ord)
    INTO condition,present,all_null
    FROM unnest(r.conkey,r.confkey) WITH ORDINALITY u(source_num,target_num,ord)
    JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=u.source_num
    JOIN pg_attribute b ON b.attrelid=r.confrelid AND b.attnum=u.target_num;
    IF r.confmatchtype='f' THEN
      present:=format('NOT (%s)',all_null);
    ELSIF r.confmatchtype<>'s' THEN RAISE EXCEPTION 'Unsupported FK match type'; END IF;
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I s WHERE (%s) AND NOT EXISTS(SELECT 1 FROM %I.%I t WHERE %s))',
      r.source_schema,r.source_table,present,r.target_schema,r.target_table,condition) INTO broken;
    IF broken THEN RAISE EXCEPTION 'Foreign key validation failed: %',r.conname; END IF;
  END LOOP;
END $validate_fk$;""")
    for table in sorted(after):
        for fk in after[table]['foreignKeys']:
            if not fk['validated']:
                raise ValueError('Unvalidated source constraint: ' + table)
        new = after[table]
        payload = literal(json.dumps(new['rows'], ensure_ascii=False, separators=(',', ':')))
        lines.append(block(f"BEGIN IF EXISTS((SELECT to_jsonb(t) FROM {table} t EXCEPT ALL SELECT value FROM jsonb_array_elements({payload}::jsonb)) UNION ALL (SELECT value FROM jsonb_array_elements({payload}::jsonb) EXCEPT ALL SELECT to_jsonb(t) FROM {table} t)) THEN RAISE EXCEPTION 'Imported data mismatch'; END IF; END"))
    lines += ['SET LOCAL session_replication_role=origin;', 'COMMIT;']
    return '\n'.join(lines) + '\n', report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('baseline')
    parser.add_argument('latest')
    parser.add_argument('output')
    args = parser.parse_args()
    sql, report = generate(read_snapshot(args.baseline), read_snapshot(args.latest))
    output = pathlib.Path(args.output)
    if output.exists():
        raise SystemExit('Output exists; preserving it')
    output.write_text(sql, encoding='utf-8')
    output.chmod(0o600)
    report['sha256'] = hashlib.sha256(sql.encode()).hexdigest()
    output.with_suffix('.report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
